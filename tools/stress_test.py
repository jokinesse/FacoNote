"""
Générateur de charge en ligne de commande pour l'API FacoNote (FastAPI).

Complément du "Stress Lab" du frontend : le navigateur est limité à ~6 connexions
simultanées par serveur, ce script ne l'est pas (asyncio + httpx).

Exemples :
    .venv\\Scripts\\python tools\\stress_test.py                          # 1000 req. mixtes, 50 en parallèle
    .venv\\Scripts\\python tools\\stress_test.py -s calculate-heavy -n 200 -c 20 --pieces 80
    .venv\\Scripts\\python tools\\stress_test.py -s quick-encode -d 30 -c 100   # 30 s de charge continue
"""

from __future__ import annotations

import argparse
import asyncio
import random
import statistics
import time
from collections import Counter
from dataclasses import dataclass
from typing import Any, Callable

import httpx

DEV_BOUNDS = [100, 120, 150, 175, 187, 200, 250, 285, 300, 333, 375, 400, 450, 500]
ZINC = ["Zinc Naturel 0.7", "Zinc Quartz 0.7", "Zinc Noir ATZ 0.7"]
ALU = ["Alu 7016 gris bleu 0.7", "Alu 9010 Blanc 0.7"]


def _rand_len() -> float:
    return round(1 + random.random() * 5, 1)


def _pieces(n: int, mix: bool) -> list[dict[str, Any]]:
    return [
        {
            "id": f"cli-{i}",
            "label": f"Profil CLI #{i + 1}",
            "dev": random.choice(DEV_BOUNDS) - random.randint(0, 10),
            "length": _rand_len(),
            "quantity": random.randint(1, 12),
            "bends": random.randint(0, 5),
            "material": random.choice(ALU) if mix and random.random() < 0.3 else random.choice(ZINC),
        }
        for i in range(n)
    ]


def _opt_request(n: int, mix: bool) -> dict[str, Any]:
    return {
        "client_name": "Stress CLI",
        "chantier_ref": "Charge",
        "material": "Zinc Naturel 0.7",
        "pieces": _pieces(n, mix),
        "available_mother_widths": [600, 650, 750, 1000],
        "use_workshop_scraps": False,
        "accepted_proposal_ids": None,
    }


@dataclass
class Scenario:
    method: str
    path: str
    expected: int
    weight: int
    body: Callable[[argparse.Namespace], Any] | None = None


SCENARIOS: dict[str, Scenario] = {
    "health": Scenario("GET", "/api/health", 200, 0),
    "quick-encode": Scenario(
        "POST", "/api/v1/optimizer/quick-encode", 200, 60,
        lambda a: {
            "raw_input": f"{random.choice(DEV_BOUNDS)}/{random.randint(1, 20)}*{_rand_len()}",
            "material": random.choice(ZINC), "length_unit": "m", "preset": "DEV_PIECE",
        },
    ),
    "auto-breakdown": Scenario(
        "POST", "/api/v1/optimizer/auto-breakdown", 200, 20,
        lambda a: {"total_meters": round(2 + random.random() * 60, 1), "current_pieces": [],
                   "target_material": random.choice(ZINC), "forced_length": None},
    ),
    "calculate-light": Scenario("POST", "/api/v1/optimizer/calculate", 200, 15, lambda a: _opt_request(5, False)),
    "calculate-heavy": Scenario("POST", "/api/v1/optimizer/calculate", 200, 0, lambda a: _opt_request(a.pieces, True)),
    "print-sheet": Scenario("POST", "/api/v1/optimizer/print-sheet", 200, 5, lambda a: _opt_request(8, False)),
    "invalid-422": Scenario(
        "POST", "/api/v1/optimizer/quick-encode", 422, 0,
        lambda a: {"raw_input": random.choice(["0/4*2", "abc/2*3", "175/3*2/0"]),
                   "material": "Zinc Naturel 0.7", "length_unit": "m", "preset": "DEV_PIECE"},
    ),
}


def pick(name: str) -> tuple[str, Scenario]:
    if name != "mixed":
        return name, SCENARIOS[name]
    pool = [(k, s) for k, s in SCENARIOS.items() if s.weight > 0]
    return random.choices(pool, weights=[s.weight for _, s in pool])[0]


@dataclass
class Result:
    scenario: str
    latency_ms: float
    status: int
    ok: bool
    error: str = ""


async def run(args: argparse.Namespace) -> list[Result]:
    results: list[Result] = []
    issued = 0
    start = time.perf_counter()
    limits = httpx.Limits(max_connections=args.concurrency, max_keepalive_connections=args.concurrency)

    def can_issue() -> bool:
        if args.duration:
            return time.perf_counter() - start < args.duration
        return issued < args.requests

    async with httpx.AsyncClient(base_url=args.url, timeout=args.timeout, limits=limits) as client:
        token: str | None = args.admin_token
        if not token and args.admin_password:
            auth_resp = await client.post("/api/v1/admin/login", json={"password": args.admin_password})
            if auth_resp.status_code != 200:
                print(f"Erreur d'authentification admin [{auth_resp.status_code}]: {auth_resp.text}")
                raise SystemExit(1)
            token = auth_resp.json()["token"]
            print("Jeton admin obtenu — pare-feu de charge contourné.")

        req_headers = {"X-Admin-Token": token} if token else {}

        async def worker() -> None:
            nonlocal issued
            while can_issue():
                issued += 1
                name, sc = pick(args.scenario)
                body = sc.body(args) if sc.body else None
                t0 = time.perf_counter()
                try:
                    resp = await client.request(sc.method, sc.path, json=body, headers=req_headers)
                    _ = resp.content
                    ok = resp.status_code == sc.expected
                    results.append(Result(name, (time.perf_counter() - t0) * 1000, resp.status_code, ok,
                                          "" if ok else resp.text[:120]))
                except httpx.TimeoutException:
                    results.append(Result(name, (time.perf_counter() - t0) * 1000, 0, False, "TIMEOUT"))
                except httpx.HTTPError as exc:
                    results.append(Result(name, (time.perf_counter() - t0) * 1000, 0, False, f"RÉSEAU: {exc}"))

        async def progress() -> None:
            while True:
                await asyncio.sleep(1)
                el = time.perf_counter() - start
                print(f"\r  {len(results):>6} réponses · {len(results) / el:7.1f} req/s · "
                      f"{sum(not r.ok for r in results)} erreurs", end="", flush=True)

        prog = asyncio.create_task(progress())
        await asyncio.gather(*(worker() for _ in range(args.concurrency)))
        prog.cancel()

    args.elapsed = time.perf_counter() - start
    print()
    return results


def pct(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    k = max(0, min(len(sorted_vals) - 1, int(round(p / 100 * len(sorted_vals) + 0.5)) - 1))
    return sorted_vals[k]


def report(results: list[Result], args: argparse.Namespace) -> int:
    lat = sorted(r.latency_ms for r in results)
    errors = [r for r in results if not r.ok]
    err_rate = 100 * len(errors) / max(1, len(results))
    p95 = pct(lat, 95)
    print("\n=== RÉSULTATS ===")
    print(f"Cible         : {args.url}  · scénario {args.scenario} · {args.concurrency} utilisateurs")
    print(f"Requêtes      : {len(results)} en {args.elapsed:.2f} s  →  {len(results) / args.elapsed:.1f} req/s")
    print(f"Erreurs       : {len(errors)} ({err_rate:.2f} %)")
    if lat:
        print(f"Latence (ms)  : min {lat[0]:.1f} · moy {statistics.fmean(lat):.1f} · p50 {pct(lat, 50):.1f} · "
              f"p95 {p95:.1f} · p99 {pct(lat, 99):.1f} · max {lat[-1]:.1f}")
    print("Codes HTTP    :", dict(Counter(r.status or r.error.split(':')[0] for r in results)))

    print("\nPar endpoint :")
    for name in sorted({r.scenario for r in results}):
        sub = sorted(r.latency_ms for r in results if r.scenario == name)
        n_err = sum(1 for r in results if r.scenario == name and not r.ok)
        print(f"  {name:<16} {len(sub):>6} req · p50 {pct(sub, 50):7.1f} · p95 {pct(sub, 95):7.1f} ms · {n_err} err.")

    for e in errors[:5]:
        print(f"  ! [{e.status}] {e.scenario}: {e.error}")

    verdict = "STABLE" if err_rate < 1 and p95 < 500 else "DÉGRADÉ" if err_rate < 5 and p95 < 2000 else "INSTABLE"
    print(f"\nVERDICT : {verdict}")
    return 0 if verdict != "INSTABLE" else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Test de charge de l'API FacoNote")
    parser.add_argument("-u", "--url", default="http://127.0.0.1:8000")
    parser.add_argument("-s", "--scenario", default="mixed", choices=[*SCENARIOS.keys(), "mixed"])
    parser.add_argument("-n", "--requests", type=int, default=1000, help="Nombre total de requêtes")
    parser.add_argument("-d", "--duration", type=float, default=0, help="Durée en s (prioritaire sur -n)")
    parser.add_argument("-c", "--concurrency", type=int, default=50, help="Utilisateurs simultanés")
    parser.add_argument("-t", "--timeout", type=float, default=30.0)
    parser.add_argument("--pieces", type=int, default=40, help="Pièces pour calculate-heavy")
    parser.add_argument("--admin-password", default=None, help="Mot de passe admin pour contourner le pare-feu de charge")
    parser.add_argument("--admin-token", default=None, help="Jeton HMAC admin déjà émis (en-tête X-Admin-Token)")
    args = parser.parse_args()

    print(f"Lancement : {args.scenario} → {args.url} ({args.concurrency} utilisateurs)")
    results = asyncio.run(run(args))
    raise SystemExit(report(results, args))


if __name__ == "__main__":
    main()
