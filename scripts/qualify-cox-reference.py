"""Generate SYNTHETIC Cox witnesses; never send customer data to a model.

Run in an isolated environment with statsmodels==0.14.6. This is a numerical
reference generator, not a product runtime dependency. No reference source
code is copied. The complete inputs, versions and output are retained.
"""

import json
from pathlib import Path
import platform
import random

import numpy as np
import scipy
import statsmodels
from statsmodels.duration.hazard_regression import PHReg

if statsmodels.__version__ != "0.14.6":
    raise RuntimeError("Reference requires exactly statsmodels 0.14.6")


def cohort(name, changing=False, stratified=False, delayed=False):
    rng = random.Random(7123)
    rows = []
    for index in range(72):
        x = [rng.uniform(-1.5, 1.5), float(index % 3 == 0)]
        stratum = "B" if stratified and index % 2 else "A"
        start = 0.25 if delayed and index % 4 == 0 else 0.0
        stop = float(rng.randint(3, 22))
        failed = rng.random() < 0.7
        # Deliberately mixed failure order, censoring and tied failures.
        intervals = [(start, stop, x, failed)]
        if changing and stop > 9:
            intervals = [
                (start, 8.25, x, False),
                (8.25, stop, [x[0] + 0.4, 1.0 - x[1]], failed),
            ]
        for part, (begin, end, values, event) in enumerate(intervals):
            rows.append({
                "id": f"synthetic-{index}-{part}",
                "subjectId": f"component-instance-{index}",
                "stratum": stratum,
                "start": begin,
                "stop": end,
                "failed": event,
                "covariates": values,
                "observedAt": begin,
            })
    model = PHReg(
        np.array([r["stop"] for r in rows]),
        np.array([r["covariates"] for r in rows]),
        status=np.array([int(r["failed"]) for r in rows]),
        entry=np.array([r["start"] for r in rows]),
        strata=np.array([r["stratum"] for r in rows]),
        ties="efron",
        missing="raise",
    )
    fit = model.fit(disp=False, maxiter=200, tol=1e-12)
    expected = {
        "coefficients": fit.params.tolist(),
        "covariance": fit.cov_params().tolist(),
        "logLikelihood": float(fit.llf),
        "score": model.score(fit.params).tolist(),
    }
    # Baseline is independently recomputed with Efron denominators. PHReg's
    # baseline helper uses Breslow and a left-continuous time convention;
    # it is NOT falsely represented as an Efron post-event reference.
    baseline = []
    for stratum in sorted(set(r["stratum"] for r in rows)):
        total = 0.0
        for time in sorted(set(r["stop"] for r in rows if r["failed"] and r["stratum"] == stratum)):
            risk = [r for r in rows if r["stratum"] == stratum and r["start"] < time <= r["stop"]]
            deaths = [r for r in risk if r["stop"] == time and r["failed"]]
            weight = lambda r: float(np.exp(np.dot(fit.params, r["covariates"])))
            denom = sum(weight(r) for r in risk)
            tied = sum(weight(r) for r in deaths)
            total += sum(1 / (denom - k * tied / len(deaths)) for k in range(len(deaths)))
            baseline.append({"stratum": stratum, "time": time, "cumulativeHazard": total})
    expected["baselineEfronPostEvent"] = baseline
    return {"name": name, "covariateNames": ["synthetic_load", "synthetic_indicator"], "rows": rows, "expected": expected}


artifact = {
    "provenance": {
        "data": "Entirely synthetic; deterministic seed 7123; no engineering thresholds or customer observations.",
        "python": platform.python_version(),
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        "statsmodels": statsmodels.__version__,
        "reference": "statsmodels.duration.hazard_regression.PHReg",
        "ties": "efron",
        "missing": "raise",
        "baselineReference": "Independent explicit Efron denominator calculation, not PHReg baseline helper.",
        "intervalConvention": "(start, stop]; fixture entry boundaries do not coincide with failures.",
        "covariance": "Model-based information inverse; not cluster-robust, causal or calibrated predictive uncertainty.",
        "sources": [
            "https://www.statsmodels.org/stable/generated/statsmodels.duration.hazard_regression.PHReg.html",
            "https://www.stat.ethz.ch/R-manual/R-devel/library/survival/html/coxph.html",
        ],
    },
    "cases": [
        cohort("tied-right-censored"),
        cohort("stratified-delayed-entry", stratified=True, delayed=True),
        cohort("piecewise-time-varying", changing=True, stratified=True),
    ],
}
destination = Path(__file__).resolve().parents[1] / "src/lib/reliability/fixtures/cox-reference.json"
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(artifact, indent=2, allow_nan=False) + "\n")
print(json.dumps({"fixture": str(destination), "cases": len(artifact["cases"]), "provenance": artifact["provenance"]}))
