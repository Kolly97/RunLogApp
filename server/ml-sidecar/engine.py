#!/usr/bin/env python3
"""RunLog ML-Sidecar. Liest einen Job (JSON) von stdin, liefert ein Ergebnis (JSON) auf stdout.

Protokoll:
  stdin  = {"kind": str, "payload": {...}}
  stdout = {"ok": bool, "kind": str, "result"|"error": ..., "meta": {...}}
  exit   = 0 bei Erfolg, 1 bei Fehler

Der Kern ist stdlib-only (Harness-Beweis: health/echo/ols laufen ohne Fremd-Pakete).
Schwere Libs (numpy / lightgbm / numpyro) sind OPTIONAL und erst für die echten Modelle (L2/L3/L6)
nötig — siehe requirements.txt. So bleibt der Sidecar auch ohne installierte Runtime testbar.
"""
import sys
import json
import platform


def _meta():
    meta = {"engine": "python", "python": platform.python_version(), "numpy": None}
    try:
        import numpy  # noqa: F401
        meta["numpy"] = numpy.__version__
    except Exception:
        pass
    return meta


def job_health(_payload):
    return {"status": "ok"}


def job_echo(payload):
    return {"echo": payload}


def job_ols(payload):
    """Einfache OLS-Geradenanpassung y ~ a + b*x (pure Python) — beweist den numerischen Datenpfad."""
    xs = payload.get("x", [])
    ys = payload.get("y", [])
    n = len(xs)
    if n < 2 or n != len(ys):
        raise ValueError("x und y brauchen gleiche Länge >= 2")
    mx = sum(xs) / n
    my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    if sxx == 0:
        raise ValueError("x ohne Varianz")
    b = sxy / sxx
    a = my - b * mx
    ss_tot = sum((y - my) ** 2 for y in ys)
    ss_res = sum((y - (a + b * x)) ** 2 for x, y in zip(xs, ys))
    r2 = (1 - ss_res / ss_tot) if ss_tot > 0 else None
    return {"intercept": a, "slope": b, "r2": r2, "n": n}


def job_dose_bayes(payload):
    """Bayesianische Dosis-Wirkung (Deliverable B, Phase B0 — Durchstich).

    Schätzt je Reiz-Kanal den Effekt auf die (wöchentliche) latente Fitness als Bayes-Regression mit
    skeptischem Nullpunkt-Prior (Ridge-Äquivalent = Partial-Pooling-Idee). Ausgabe je Kanal:
    Posterior-Mittel, sd, 94%-HDI, P(beta>0).

    Engine-Wahl: PyMC (MCMC) falls installiert; sonst analytische Conjugate-Bayes (numpy). Beide sind ECHTE
    Bayes-Posteriors — der numpy-Pfad hält den Durchstich unabhängig vom PyMC-Packaging lauffähig. Die
    hierarchische AR(1)-/Impulse-Response-Erweiterung (gefittetes tau je Kanal) folgt in Phase B1.
    """
    import numpy as np  # optional dep — fehlt sie, wirft der Handler → TS-Fallback greift

    channels = payload.get("channels", [])
    X = np.asarray(payload.get("X", []), dtype=float)
    y = np.asarray(payload.get("y", []), dtype=float)
    w = payload.get("weights")
    if X.ndim != 2 or X.shape[0] != y.shape[0] or X.shape[1] != len(channels):
        raise ValueError("X/y/channels inkonsistent")
    n, k = X.shape
    if n < k + 2:
        raise ValueError("zu wenig Wochen fuer %d Kanaele" % k)

    # Standardisieren (z-Score je Spalte) + y zentrieren → Effekt = Delta Fitness je +1 SD Kanal-Last.
    mu_x = X.mean(axis=0)
    sd_x = X.std(axis=0, ddof=0)
    sd_x[sd_x < 1e-9] = 1.0
    Z = (X - mu_x) / sd_x
    yc = y - y.mean()
    wt = np.ones(n) if w is None else np.asarray(w, dtype=float)
    W = np.diag(wt)

    tau2 = 1.0  # schwach-informativer Prior beta ~ N(0, tau2) auf standardisierter Skala (skeptisch, Ridge-artig)
    method = "conjugate"
    try:
        import pymc as pm  # noqa: F401
        method = "pymc"
    except Exception:
        pm = None

    if pm is not None:
        with pm.Model():
            beta = pm.Normal("beta", 0.0, tau2 ** 0.5, shape=k)
            sigma = pm.HalfNormal("sigma", 1.0)
            mu = pm.math.dot(Z, beta)
            pm.Normal("y", mu=mu, sigma=sigma, observed=yc)  # (Recency-Gewichte in B1)
            idata = pm.sample(1000, tune=1000, chains=2, cores=1, random_seed=42,
                              progressbar=False, compute_convergence_checks=False)
        post = idata.posterior["beta"].to_numpy().reshape(-1, k)
        mean = post.mean(axis=0)
        sd = post.std(axis=0)
        lo = np.percentile(post, 3.0, axis=0)
        hi = np.percentile(post, 97.0, axis=0)
        p_pos = (post > 0).mean(axis=0)
    else:
        # Analytischer Gauss-Posterior (bekannte-sigma Plug-in): Lambda = ZᵀWZ/σ² + I/τ², Σ=Λ⁻¹, μ=Σ ZᵀW y/σ².
        beta_ridge = np.linalg.solve(Z.T @ W @ Z + (1.0 / tau2) * np.eye(k), Z.T @ W @ yc)
        resid = yc - Z @ beta_ridge
        dof = max(1.0, n - k)
        sigma2 = max(float(resid.T @ np.diag(wt) @ resid) / dof, 1e-6)
        Lam = (Z.T @ W @ Z) / sigma2 + np.eye(k) / tau2
        Sigma = np.linalg.inv(Lam)
        mean = Sigma @ (Z.T @ W @ yc) / sigma2
        sd = np.sqrt(np.clip(np.diag(Sigma), 1e-12, None))
        z94 = 1.88079  # 94%-HDI ~ ±1.88 sd (Gauss)
        lo = mean - z94 * sd
        hi = mean + z94 * sd
        # P(beta>0) = Phi(mean/sd) via erf
        from math import erf, sqrt
        p_pos = np.array([0.5 * (1.0 + erf((m / s) / sqrt(2.0))) for m, s in zip(mean, sd)])

    channels_out = [
        {"channel": channels[j], "mean": float(mean[j]), "sd": float(sd[j]),
         "hdi_low": float(lo[j]), "hdi_high": float(hi[j]), "p_positive": float(p_pos[j])}
        for j in range(k)
    ]
    return {"method": method, "n_weeks": int(n), "channels": channels_out}


def job_dose_ir(payload):
    """Bayes-Impulse-Response (Deliverable B, Phase B2a): schätzt je Kanal GAIN beta_c UND ZERFALL tau_c.

    Modell: latente Fitness ~ alpha + Σ_c beta_c * g_c[t],  g_c[t] = Σ_{s<=t} z_load_c[s]*exp(-(t-s)/tau_c).
    tau_c (in Wochen) wird mitgefittet → liefert RETENTION/HALBWERTSZEIT (= tau*ln2) und einen sauberen Gain.
    beta wird auf FIXER Skala (g bei Prior-tau0) standardisiert → stabil & kanal-vergleichbar. PyMC-MCMC, sonst
    numpy-Conjugate mit fester tau (kein tau-Estimate). Rein beobachtend; τ/β sind Posterior-Zusammenfassungen.
    """
    import numpy as np

    channels = payload.get("channels", [])
    loads = np.asarray(payload.get("loads", []), dtype=float)      # T x C, ROHE Wochen-Last
    y = np.asarray(payload.get("y", []), dtype=float)              # T
    C = len(channels)
    if loads.ndim != 2 or loads.shape[1] != C or loads.shape[0] != y.shape[0]:
        raise ValueError("loads/y/channels inkonsistent")
    T = loads.shape[0]
    if T < C + 3:
        raise ValueError("zu wenig Wochen")
    tw = np.asarray(payload.get("t_weeks", list(range(T))), dtype=float)  # Wochen-Index je Zeile (Lücken-fest)

    mu_l = loads.mean(axis=0); sd_l = loads.std(axis=0); sd_l[sd_l < 1e-9] = 1.0
    Z = (loads - mu_l) / sd_l                                      # standardisierte Lasten (fix)
    yc = y - y.mean()
    D = tw[:, None] - tw[None, :]                                  # T x T Wochen-Distanz
    mask = (D >= 0).astype(float)
    tau0 = 6.0                                                     # Prior-Mittel ~6 Wochen (≈ EWMA-42 Tage)
    # Fixe Standardisierungs-Skala je Kanal: std von g bei tau0 (macht beta vergleichbar OHNE tau-abhängige Division).
    K0 = np.exp(-D / tau0) * mask
    scale = np.array([max(float((K0 @ Z[:, c]).std()), 1e-6) for c in range(C)])

    # Composition/„Volumen-bereinigt": die Kanäle sind gegen den Gesamt-Umfang residualisiert → als Spalten
    # rank-defizient (Σ über Kanäle ~0). Sum-to-zero-Constraint (Σβ=0) identifiziert die Effekte wieder: β wird
    # in einer orthonormalen Nullsummen-Basis Bz (C×(C-1)) parametrisiert → jeder Effekt = Abweichung vom mittleren
    # Mix-Effekt. Bz stammt aus dem Zentriermatrix-SVD (Spalten summieren zu 0, orthonormal).
    sum_zero = bool(payload.get("sum_zero", False)) and C >= 2
    Bz = None
    if sum_zero:
        U, _, _ = np.linalg.svd(np.eye(C) - np.ones((C, C)) / C)
        Bz = U[:, :C - 1]

    method = "conjugate-ir"
    try:
        import pymc as pm
        import pytensor.tensor as pt
        method = "pymc-ir"
    except Exception:
        pm = None

    if pm is not None:
        with pm.Model():
            log_tau = pm.Normal("log_tau", np.log(tau0), 0.5, shape=C)  # tau in Wochen (LogNormal, schwach informativ)
            tau = pm.Deterministic("tau", pm.math.exp(log_tau))
            if sum_zero:
                beta_raw = pm.Normal("beta_raw", 0.0, 1.0, shape=C - 1)   # C-1 freie Richtungen …
                beta = pm.Deterministic("beta", pt.dot(pt.as_tensor_variable(Bz), beta_raw))  # … → Σβ=0
            else:
                beta = pm.Normal("beta", 0.0, 1.0, shape=C)
            alpha = pm.Normal("alpha", 0.0, 1.0)
            sigma = pm.HalfNormal("sigma", 1.0)
            gcols = []
            for c in range(C):
                K = pt.exp(-D / tau[c]) * mask
                gcols.append(pt.dot(K, Z[:, c]) / scale[c])
            G = pt.stack(gcols, axis=1)
            pm.Normal("y", mu=alpha + pt.dot(G, beta), sigma=sigma, observed=yc)
            idata = pm.sample(400, tune=500, chains=2, cores=1, random_seed=42,
                              target_accept=0.9, progressbar=False, compute_convergence_checks=False)
        pb = idata.posterior["beta"].to_numpy().reshape(-1, C)
        ptau = idata.posterior["tau"].to_numpy().reshape(-1, C)
        mean, sdb = pb.mean(0), pb.std(0)
        lo, hi = np.percentile(pb, 3, 0), np.percentile(pb, 97, 0)
        p_pos = (pb > 0).mean(0)
        tau_m, tau_lo, tau_hi = ptau.mean(0), np.percentile(ptau, 3, 0), np.percentile(ptau, 97, 0)
    else:
        # Fallback: feste tau0 → g, dann analytischer Ridge-Conjugate-Posterior (kein tau-Estimate).
        G = np.column_stack([(K0 @ Z[:, c]) / scale[c] for c in range(C)])
        tau2 = 1.0
        if sum_zero:
            # Fit in der Nullsummen-Basis (rank-defizientes Design → identifiziert), dann β = Bz @ γ zurückprojizieren.
            Gr = G @ Bz
            k = C - 1
            gr0 = np.linalg.solve(Gr.T @ Gr + (1.0 / tau2) * np.eye(k), Gr.T @ yc)
            resid = yc - Gr @ gr0
            sig2 = max(float(resid @ resid) / max(1.0, T - k), 1e-6)
            Sig_r = np.linalg.inv(Gr.T @ Gr / sig2 + np.eye(k) / tau2)
            mean = Bz @ (Sig_r @ (Gr.T @ yc) / sig2)
            sdb = np.sqrt(np.clip(np.diag(Bz @ Sig_r @ Bz.T), 1e-12, None))
        else:
            br = np.linalg.solve(G.T @ G + (1.0 / tau2) * np.eye(C), G.T @ yc)
            resid = yc - G @ br
            sig2 = max(float(resid @ resid) / max(1.0, T - C), 1e-6)
            Sigma = np.linalg.inv(G.T @ G / sig2 + np.eye(C) / tau2)
            mean = Sigma @ (G.T @ yc) / sig2
            sdb = np.sqrt(np.clip(np.diag(Sigma), 1e-12, None))
        z94 = 1.88079
        lo, hi = mean - z94 * sdb, mean + z94 * sdb
        from math import erf, sqrt
        p_pos = np.array([0.5 * (1.0 + erf((m / s) / sqrt(2.0))) for m, s in zip(mean, sdb)])
        tau_m = np.full(C, tau0); tau_lo = np.full(C, np.nan); tau_hi = np.full(C, np.nan)

    # --- Was-wäre-wenn-Trajektorie: kanonischer Block (+1 SD Last, K Wochen), Prognose über H Wochen ---
    # Δ latente Fitness[t] = β * g_step[t]/scale,  g_step[t] = Σ_{s=1..min(t,K)} exp(-(t-s)/τ).
    # Propagiert β- UND τ-Unsicherheit (PyMC: über Draws; Conjugate: β-sd, feste τ).
    K, H = 4, 12
    def whatif(beta_draws, tau_draws, sc):
        # beta_draws/tau_draws: (n,)  → Trajektorie (H,) Verteilung
        tvec = np.arange(1, H + 1)
        trajs = np.empty((len(beta_draws), H))
        for i, (b, ta) in enumerate(zip(beta_draws, tau_draws)):
            g = np.array([sum(np.exp(-(t - s) / ta) for s in range(1, min(t, K) + 1)) for t in tvec])
            trajs[i] = b * g / sc
        m = trajs.mean(0); ql = np.percentile(trajs, 3, 0); qh = np.percentile(trajs, 97, 0)
        pk = int(np.argmax(m))
        return {"block_weeks": K, "horizon_weeks": H, "peak_week": pk + 1,
                "peak_delta": float(m[pk]), "peak_low": float(ql[pk]), "peak_high": float(qh[pk]),
                "trajectory": [{"w": int(w), "mean": float(m[k]), "lo": float(ql[k]), "hi": float(qh[k])} for k, w in enumerate(tvec)]}

    ln2 = 0.6931471805599453
    nn = lambda x: (None if not np.isfinite(x) else float(x))
    out = []
    for j in range(C):
        if method == "pymc-ir":
            sub = slice(0, min(400, pb.shape[0]))
            wi = whatif(pb[sub, j], ptau[sub, j], scale[j])
        else:
            # Conjugate: β aus N(mean,sd), feste τ0 → analytisches Band
            bdraw = np.array([mean[j] - 1.88079 * sdb[j], mean[j], mean[j] + 1.88079 * sdb[j]])
            wi = whatif(bdraw, np.full(3, tau0), scale[j])
        out.append({
            "channel": channels[j], "mean": float(mean[j]), "sd": float(sdb[j]),
            "hdi_low": float(lo[j]), "hdi_high": float(hi[j]), "p_positive": float(p_pos[j]),
            "tau_weeks": nn(tau_m[j]), "tau_low": nn(tau_lo[j]), "tau_high": nn(tau_hi[j]),
            "half_life_weeks": nn(tau_m[j] * ln2) if np.isfinite(tau_m[j]) else None,
            "whatif": wi,
        })
    return {"method": method, "n_weeks": int(T), "channels": out}


def job_blocks_bayes(payload):
    """Hierarchische (Partial-Pooling) Auswertung gruppierter Block-Deltas (Regime/Schwerpunkt) — der ‚komplexe'
    Bayes-Pfad für Passive Inferenz & Methoden-Schwerpunkt. CS negativ = besser.

    Modell: y_gb ~ Normal(μ_g, σ), μ_g ~ Normal(μ0, τ) [Partial Pooling]. Ausgabe je Gruppe: Posterior-Mittel,
    94%-HDI, P(μ<0)=P(hilft). PyMC-MCMC; sonst analytischer normal-normal Empirical-Bayes-Fallback (identisches Modell).
    """
    import numpy as np

    groups = payload.get("groups", [])
    labels = [g["group"] for g in groups]
    ys = [np.asarray(g.get("deltas", []), dtype=float) for g in groups]
    ns = [len(y) for y in ys]
    G = len(groups)
    if G < 1 or sum(ns) < 1:
        raise ValueError("keine Block-Deltas")

    method = "eb"
    try:
        import pymc as pm
        import pytensor.tensor as pt
        if sum(ns) >= G + 2 and G >= 2:
            method = "pymc-hier"
    except Exception:
        pm = None

    if pm is not None and method == "pymc-hier":
        yall = np.concatenate(ys)
        gidx = np.concatenate([np.full(n, i) for i, n in enumerate(ns)]).astype("int64")
        with pm.Model():
            mu0 = pm.Normal("mu0", 0.0, 20.0)
            tau = pm.HalfNormal("tau", 15.0)
            sigma = pm.HalfNormal("sigma", 15.0)
            mu = pm.Normal("mu", mu0, tau, shape=G)
            pm.Normal("y", mu=mu[gidx], sigma=sigma, observed=yall)
            idata = pm.sample(800, tune=800, chains=2, cores=1, random_seed=42,
                              target_accept=0.9, progressbar=False, compute_convergence_checks=False)
        pm_mu = idata.posterior["mu"].to_numpy().reshape(-1, G)
        mean = pm_mu.mean(0); lo = np.percentile(pm_mu, 3, 0); hi = np.percentile(pm_mu, 97, 0)
        p_better = (pm_mu < 0).mean(0)
    else:
        # Analytischer normal-normal EB (geschlossene Form) — deckt sich mit trainingVerdict.empiricalBayesGroups.
        m = np.array([y.mean() if len(y) else 0.0 for y in ys])
        n = np.array(ns, dtype=float)
        N = n.sum()
        within = sum(float(((y - y.mean()) ** 2).sum()) for y in ys if len(y) > 1)
        s2 = max(within / max(1.0, N - G), 4.0)
        mu0 = float((n * m).sum() / N)
        Vm = float(((m - mu0) ** 2).sum() / (G - 1)) if G > 1 else 0.0
        tau2 = max(0.0, Vm - (s2 / n).mean())
        mean = np.empty(G); lo = np.empty(G); hi = np.empty(G); p_better = np.empty(G)
        from math import erf, sqrt
        for i in range(G):
            se2 = s2 / n[i]
            pv = 1.0 / (1.0 / se2 + 1.0 / tau2) if tau2 > 0 else se2
            pm_i = pv * (m[i] / se2 + mu0 / tau2) if tau2 > 0 else mu0
            sd = sqrt(pv)
            mean[i] = pm_i; lo[i] = pm_i - 1.96 * sd; hi[i] = pm_i + 1.96 * sd
            p_better[i] = 0.5 * (1.0 + erf((-pm_i / sd) / sqrt(2.0)))

    out = [{"group": labels[i], "mean": round(float(mean[i]), 1), "hdi_low": round(float(lo[i]), 1),
            "hdi_high": round(float(hi[i]), 1), "p_better": round(float(p_better[i]), 2), "n_blocks": ns[i]} for i in range(G)]
    return {"method": method, "groups": out}


def job_phase_bayes(payload):
    """Phase×Reiz (Zyklus): hierarchische Random-Effects-Shrinkage der Zell-Effektgrößen (Hedges' g) Richtung 0.

    Modell: g_k ~ Normal(θ_k, se_k), θ_k ~ Normal(0, τ) [Partial Pooling zum skeptischen Null]. Verrauschte/
    kleine Zellen werden zu 0 gezogen → konservativer, mit ehrlichem HDI + P(>0). GLEICHE Effektgrößen-Skala
    wie die TS-Auswertung (nur geschrumpft). PyMC-MCMC; sonst analytischer DerSimonian-Laird-EB-Fallback.
    """
    import numpy as np

    eff = payload.get("effects", [])
    keys = [e["key"] for e in eff]
    g = np.array([float(e["g"]) for e in eff], dtype=float)
    se = np.array([max(float(e.get("se", 0.5)), 0.05) for e in eff], dtype=float)
    K = len(eff)
    if K < 1:
        raise ValueError("keine Zellen")

    method = "eb"
    try:
        import pymc as pm
        if K >= 3:
            method = "pymc-hier"
    except Exception:
        pm = None

    if pm is not None and method == "pymc-hier":
        with pm.Model():
            tau = pm.HalfNormal("tau", 0.5)
            theta = pm.Normal("theta", 0.0, tau, shape=K)
            pm.Normal("g", mu=theta, sigma=se, observed=g)
            idata = pm.sample(800, tune=800, chains=2, cores=1, random_seed=42,
                              target_accept=0.9, progressbar=False, compute_convergence_checks=False)
        th = idata.posterior["theta"].to_numpy().reshape(-1, K)
        mean = th.mean(0); lo = np.percentile(th, 3, 0); hi = np.percentile(th, 97, 0); p_pos = (th > 0).mean(0)
    else:
        # DerSimonian-Laird τ² (Heterogenität um 0) + Shrinkage-Posterior gegen Prior-Mittel 0.
        w = 1.0 / se ** 2
        Q = float((w * g * g).sum())
        c = float(w.sum() - (w * w).sum() / w.sum()) if w.sum() > 0 else 0.0
        tau2 = max(0.0, (Q - (K - 1)) / c) if c > 0 else 0.0
        from math import erf, sqrt
        mean = np.empty(K); lo = np.empty(K); hi = np.empty(K); p_pos = np.empty(K)
        for i in range(K):
            if tau2 > 0:
                pv = 1.0 / (1.0 / se[i] ** 2 + 1.0 / tau2)
                pm_i = pv * (g[i] / se[i] ** 2)
            else:
                pm_i = 0.0; pv = 1e-6
            sd = sqrt(pv)
            mean[i] = pm_i; lo[i] = pm_i - 1.96 * sd; hi[i] = pm_i + 1.96 * sd
            p_pos[i] = 0.5 * (1.0 + erf((pm_i / sd) / sqrt(2.0))) if sd > 0 else (1.0 if pm_i > 0 else 0.0)

    out = [{"key": keys[i], "effect": round(float(mean[i]), 2), "hdi_low": round(float(lo[i]), 2),
            "hdi_high": round(float(hi[i]), 2), "p_positive": round(float(p_pos[i]), 2)} for i in range(K)]
    return {"method": method, "cells": out}


def job_exposure_dose(payload):
    """F3: Regime/Schwerpunkt-Dosis-Wirkung auf die LATENTE FITNESS. Für jedes Label β = Δ latente Fitness je
    +1 SD Expositions-CTL. Zwei Modelle: Mediator (absolut) + Komposition (gegen Gesamt-Last residualisiert =
    'bei gleichem Umfang'). Statistisch streng: (a) L2-'sd' der latenten Fitness als BEOBACHTUNGSGEWICHTE
    (errors-in-variables-leicht), (b) regularisierte Regression = Bayes-MAP mit Prior β~N(0,1/λ) (Partial Pooling),
    (c) MOVING-BLOCK-BOOTSTRAP-CIs → robust gegen Autokorrelation der geglätteten Latenz. Rein numpy (schwer,
    reproduzierbar per Seed). Beobachtend/„as-if causal".
    """
    import numpy as np

    labels = payload["labels"]
    X = np.asarray(payload["X"], dtype=float)          # T x L (rohe Expositionen)
    total = np.asarray(payload["total"], dtype=float)  # T
    y = np.asarray(payload["y"], dtype=float)          # T (latente Fitness)
    y_sd = np.asarray(payload.get("y_sd", [1.0] * len(y)), dtype=float)
    T, L = X.shape
    if T < L + 4 or L < 2:
        raise ValueError("zu wenig Wochen/Labels")
    reps = int(payload.get("boot", 400))
    lam = float(payload.get("lam", 1.0))               # Ridge-Penalty = Prior-Präzision (Partial Pooling)
    block = max(3, int(round(T ** 0.5)))               # Moving-Block-Länge ~ √T
    w = 1.0 / np.maximum(y_sd, 1e-6) ** 2              # L2-Unsicherheit → Gewicht (kleinere sd = mehr Vertrauen)
    w = w / w.mean()
    yc = y - np.average(y, weights=w)
    rng = np.random.default_rng(42)

    def design(model):
        if model == "composition":                    # gegen Gesamt-Last residualisieren → „bei gleichem Umfang"
            tt = np.column_stack([np.ones(T), (total - total.mean()) / (total.std() or 1.0)])
            P = np.eye(T) - tt @ np.linalg.pinv(tt)
            return P @ X
        return X

    def solve(Z, wv, yv):
        A = Z.T @ (wv[:, None] * Z) + lam * np.eye(L)
        return np.linalg.solve(A, Z.T @ (wv * yv))

    out = {}
    for model in ("mediator", "composition"):
        Xm = design(model)
        mu = Xm.mean(0); sd = Xm.std(0); sd[sd < 1e-9] = 1.0
        Z = (Xm - mu) / sd                             # standardisiert → β vergleichbar (Δ latent je +1 SD)
        beta = solve(Z, w, yc)
        nb = int(np.ceil(T / block))
        boots = np.empty((reps, L))
        for r in range(reps):
            starts = rng.integers(0, T - block + 1, size=nb)
            sel = np.concatenate([np.arange(s, s + block) for s in starts])[:T]
            boots[r] = solve(Z[sel], w[sel], yc[sel])
        lo = np.percentile(boots, 3, 0); hi = np.percentile(boots, 97, 0); p = (boots > 0).mean(0)
        out[model] = [{"label": labels[j], "beta": round(float(beta[j]), 3), "ci_low": round(float(lo[j]), 3),
                       "ci_high": round(float(hi[j]), 3), "p_positive": round(float(p[j]), 2)} for j in range(L)]
    return {"method": "numpy-ridge-boot", "n_weeks": int(T), "models": out}


def job_banister_ff(payload):
    """Banister Fitness−Fatigue (Zweikomponenten): fittet perf = p0 + k1·Fit − k2·Fat an die gemessene Leistung
    und simuliert daraus das optimale Taper/Peaking. Fit/Fat = exp-Faltung der Tageslast mit τ1 (langsam) / τ2
    (schnell). PyMC-MCMC mit engen τ-Priors (nur wenn fit_tau); sonst k1,k2,p0 bei fixem τ. Rein beobachtend.
    Spiegelt die Fixe-Skala + Unsicherheits-Propagation von job_dose_ir.
    """
    import numpy as np

    load = np.asarray(payload.get("load", []), dtype=float)          # (D,) Tages-TSS, [D-1] = heute
    t_obs = np.asarray(payload.get("t_obs", []), dtype=int)          # (n,) Tag-Offsets der Beobachtungen
    y = np.asarray(payload.get("y", []), dtype=float)               # (n,) z-standardisierte Leistung
    r = np.asarray(payload.get("r", []), dtype=float)               # (n,) Beobachtungsrauschen (z-SD)
    D = load.shape[0]  # Anzahl Wochen
    n = y.shape[0]
    if n < 3 or D < 12 or t_obs.shape[0] != n:
        raise ValueError("banister: zu wenig/inkonsistente Daten")
    fit_tau = bool(payload.get("fit_tau", False))
    tau1_0 = float(payload.get("tau1_0", 6.0))   # Wochen (≈ CTL 42 d)
    tau2_0 = float(payload.get("tau2_0", 1.5))   # Wochen (≈ ATL 10 d)
    H = int(payload.get("horizon_days", 21))
    taper_frac = float(payload.get("taper_frac", 0.55))
    recent_load = float(payload.get("recent_load", 0.0))
    scale_perf = float(payload.get("scale_perf", 1.0))

    s_idx = np.arange(D)
    # Faltungs-Matrix an den Beobachtungen: Dist[i,s] = t_obs[i] − s, kausal (s ≤ t_obs[i]).
    Dist = t_obs[:, None] - s_idx[None, :]
    mask = (Dist >= 0).astype(float)

    def ff_obs(ta1, ta2):
        K1 = np.exp(-Dist / ta1) * mask
        K2 = np.exp(-Dist / ta2) * mask
        return K1 @ load, K2 @ load

    # EINE gemeinsame FIXE Skala bei τ0 (bewahrt die Banister-Taper-Bedingung ρ>1; τ-unabhängig).
    fit0o, fat0o = ff_obs(tau1_0, tau2_0)
    s = max(float(fit0o.std()), 1e-6)

    method = "ridge-banister"
    try:
        import pymc as pm
        import pytensor.tensor as pt
        method = "pymc-banister"
    except Exception:
        pm = None

    if pm is not None:
        with pm.Model():
            if fit_tau:
                log_tau1 = pm.Normal("log_tau1", np.log(tau1_0), 0.25)
                log_tau2 = pm.Normal("log_tau2", np.log(tau2_0), 0.30)
                tau1 = pm.Deterministic("tau1", pm.math.exp(log_tau1))
                tau2 = pm.Deterministic("tau2", pm.math.exp(log_tau2))
                K1 = pt.exp(-Dist / tau1) * mask
                K2 = pt.exp(-Dist / tau2) * mask
                A = pt.dot(K1, load) / s
                B = pt.dot(K2, load) / s
            else:
                A = fit0o / s
                B = fat0o / s
            # Fit/Fat sind kollinear → k1,k2 nicht frei trennbar. Reparametrisierung k2 = ρ·k1 mit ρ (Fatigue:
            # Fitness-Verhältnis) um den Physiologie-Prior ρ0≈1.5 (Banister: k2>k1 → Taper hilft) → Fatigue-Term
            # immer positiv, ρ bewegt sich nur, wenn die Daten es tragen (sonst nahe Prior = Standard-Taper).
            k1 = pm.HalfNormal("k1", 1.0)
            rho = pm.TruncatedNormal("rho", mu=1.5, sigma=0.5, lower=0.3, upper=3.0)
            k2 = pm.Deterministic("k2", rho * k1)
            p0 = pm.Normal("p0", 0.0, 1.0)
            s_extra = pm.HalfNormal("s_extra", 0.5)
            sigma = pt.sqrt(r ** 2 + s_extra ** 2)
            pm.Normal("obs", mu=p0 + k1 * A - k2 * B, sigma=sigma, observed=y)
            idata = pm.sample(400, tune=500, chains=2, cores=1, random_seed=42,
                              target_accept=0.9, progressbar=False, compute_convergence_checks=False)
        post = idata.posterior
        k1d = post["k1"].to_numpy().reshape(-1)
        k2d = post["k2"].to_numpy().reshape(-1)
        rhod = post["rho"].to_numpy().reshape(-1)
        if fit_tau:
            t1d = post["tau1"].to_numpy().reshape(-1)
            t2d = post["tau2"].to_numpy().reshape(-1)
        else:
            t1d = np.full(k1d.shape, tau1_0)
            t2d = np.full(k2d.shape, tau2_0)
    else:
        # numpy-Fallback (Python ohne PyMC): fixe τ, fixes ρ0 (kollinear), 2-Param-WLS auf C = (Fit − ρ0·Fat)/s.
        rho0 = 1.5
        C = (fit0o - rho0 * fat0o) / s
        X = np.column_stack([np.ones(n), C])
        W = np.diag(1.0 / np.maximum(r ** 2, 1e-9))
        XtWX = X.T @ W @ X + np.diag([0.0, 1.0])
        beta = np.linalg.solve(XtWX, X.T @ W @ y)
        resid = y - X @ beta
        sig2 = max(float(resid @ W @ resid) / max(1.0, n - 2), 1e-6)
        cov = np.linalg.inv(XtWX) * sig2
        k1m = max(0.0, float(beta[1])); k1s = float(np.sqrt(max(cov[1, 1], 1e-8)))
        rng = np.random.default_rng(42)
        k1d = np.clip(rng.normal(k1m, k1s, 600), 0, None)
        rhod = np.full(600, rho0)
        k2d = rhod * k1d
        t1d = np.full(600, tau1_0); t2d = np.full(600, tau2_0)

    # --- Charakteristische Taper-Simulation je Draw in TAGESRASTER (renntag-genau): τ_Tage = 7·τ_Wochen,
    #     Tageslast = chronisch/7. Vom Steady-State bei chronischer Last H Tage reduzierte Last fortschreiben.
    #     Niveaus von Tages-/Wochen-EWMA stimmen → s (Wochen-Fit) bleibt konsistent. Stabil, tagesform-unabhängig.
    m = min(300, k1d.shape[0])
    sel = np.linspace(0, k1d.shape[0] - 1, m).astype(int)
    daily_load = recent_load / 7.0
    taper_load = daily_load * taper_frac
    trajs = np.empty((m, H))
    for j, ix in enumerate(sel):
        d1 = np.exp(-1.0 / (t1d[ix] * 7.0)); d2 = np.exp(-1.0 / (t2d[ix] * 7.0))
        f0 = daily_load / (1.0 - d1); g0 = daily_load / (1.0 - d2)  # Tages-Steady-State
        f, g = f0, g0
        for d in range(H):
            f = f * d1 + taper_load; g = g * d2 + taper_load
            trajs[j, d] = (k1d[ix] * (f - f0) - k2d[ix] * (g - g0)) / s
    tmean = trajs.mean(0); tlo = np.percentile(trajs, 3, 0); thi = np.percentile(trajs, 97, 0)
    pk = int(np.argmax(tmean))

    pct = lambda a, q: float(np.percentile(a, q))
    k1_m, k2_m = float(k1d.mean()), float(k2d.mean())
    return {
        "method": method, "fit_tau": fit_tau, "coverage_ok": fit_tau, "n_obs": int(n),
        "k1": k1_m, "k1_low": pct(k1d, 3), "k1_high": pct(k1d, 97),
        "k2": k2_m, "k2_low": pct(k2d, 3), "k2_high": pct(k2d, 97),
        "tau1": float(t1d.mean()) * 7.0, "tau2": float(t2d.mean()) * 7.0,  # Anzeige in Tagen
        "ratio": float(rhod.mean()),
        "taper_days": pk + 1, "peak_day": pk + 1,
        "peak_gain": float(tmean[pk]), "peak_low": float(tlo[pk]), "peak_high": float(thi[pk]),
        "peak_gain_disp": float(tmean[pk]) * scale_perf, "scale_perf": scale_perf,
        "trajectory": [{"d": d + 1, "mean": float(tmean[d]), "lo": float(tlo[d]), "hi": float(thi[d])} for d in range(H)],
        "reasons": [] if fit_tau else ["τ fix (zu wenig belastbare Marker fürs τ-Fitting)"],
    }


HANDLERS = {"health": job_health, "echo": job_echo, "ols": job_ols, "dose_bayes": job_dose_bayes,
            "dose_ir": job_dose_ir, "blocks_bayes": job_blocks_bayes, "phase_bayes": job_phase_bayes,
            "exposure_dose": job_exposure_dose, "banister_ff": job_banister_ff}


def main():
    kind = None
    try:
        raw = sys.stdin.read()
        job = json.loads(raw) if raw.strip() else {}
        kind = job.get("kind", "health")
        handler = HANDLERS.get(kind)
        if handler is None:
            raise ValueError("unbekannter job kind: %s" % kind)
        result = handler(job.get("payload", {}))
        out = {"ok": True, "kind": kind, "result": result, "meta": _meta()}
    except Exception as e:  # noqa: BLE001
        out = {"ok": False, "kind": kind, "error": str(e), "meta": _meta()}
    sys.stdout.write(json.dumps(out))
    sys.stdout.flush()
    sys.exit(0 if out["ok"] else 1)


if __name__ == "__main__":
    main()
