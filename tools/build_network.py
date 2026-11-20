"""Génère js/network.js : la liste des lignes RER et métro et de leurs gares.

À relancer seulement si une ligne ou une gare est créée (ex. prolongement de ligne).
Usage :  PRIM_API_KEY=ta_cle python3 tools/build_network.py
"""
import json
import os
import pathlib
import urllib.request

NAVITIA = "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia"
MODES = {"RER": "RapidTransit", "METRO": "Metro"}
OUTPUT = pathlib.Path(__file__).resolve().parent.parent / "js" / "network.js"


def get(path):
    request = urllib.request.Request(NAVITIA + path, headers={"apikey": os.environ.get("PRIM_API_KEY", "")})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def sort_key(line):
    # 1, 2, 3, 3B, 4 … 14 pour le métro ; A … E pour le RER
    code = line["code"]
    digits = "".join(c for c in code if c.isdigit())
    return (int(digits) if digits else 0, code)


def metro_plan(line_navitia_id):
    """Schéma de ligne : un tronc (liste de gares dans l'ordre) + des branches.

    Chaque branche = gares hors du tronc, accrochées au tronc par `from` (index de la gare
    du tronc juste avant) et/ou `to` (juste après). Une branche avec les deux est une boucle
    ou un détour (ligne 10, 7bis) ; avec un seul, c'est une fourche (lignes 7, 13).
    """
    routes = get(f"/lines/{line_navitia_id}/routes?count=100&depth=0")["routes"]
    sequences = set()
    for route in routes:
        journeys = get(f"/routes/{route['id']}/vehicle_journeys?count=10&depth=2").get("vehicle_journeys", [])
        for journey in journeys:
            ids = tuple(st["stop_point"]["stop_area"]["id"].split(":")[-1] for st in journey["stop_times"])
            if len(ids) >= 2:
                sequences.add(ids)
    if not sequences:
        return None

    ordered = sorted(sequences, key=len, reverse=True)
    trunk = list(ordered[0])
    position = {sid: i for i, sid in enumerate(trunk)}
    branches = []
    known = set(trunk)

    for seq in ordered[1:]:
        # Met le trajet dans le même sens que le tronc
        shared = [position[s] for s in seq if s in position]
        if len(shared) >= 2 and shared[0] > shared[-1]:
            seq = seq[::-1]
        run, before = [], None
        for sid in list(seq) + [None]:
            if sid is not None and sid not in position:
                run.append(sid)
                continue
            if run:
                if not set(run) <= known:  # branche pas encore connue
                    branches.append({"ids": run, "from": before, "to": position.get(sid) if sid else None})
                    known.update(run)
                run = []
            before = position.get(sid) if sid else None
    return {"trunk": trunk, "branches": branches}


def main():
    lines = []
    for mode, navitia_mode in MODES.items():
        data = get(f"/commercial_modes/commercial_mode:{navitia_mode}/lines?count=100")
        for line in sorted(data["lines"], key=sort_key):
            line_id = line["id"].split(":")[-1]  # ex. C01743
            stops = get(f"/lines/{line['id']}/stop_areas?count=400")["stop_areas"]
            stations = sorted(
                (
                    {
                        "id": s["id"].split(":")[-1],
                        "name": s["name"],
                        "lat": round(float(s["coord"]["lat"]), 5),
                        "lon": round(float(s["coord"]["lon"]), 5),
                    }
                    for s in stops
                ),
                key=lambda s: s["name"],
            )
            lines.append(
                {
                    "id": f"{mode}_{line['code']}",
                    "mode": mode,
                    "code": line["code"].replace("B", "bis") if mode == "METRO" and line["code"].endswith("B") else line["code"],
                    "ref": f"STIF:Line::{line_id}:",
                    "color": "#" + line["color"],
                    "textColor": "#" + line["text_color"],
                    "stations": stations,
                }
            )
            if mode == "METRO":
                lines[-1]["plan"] = metro_plan(line["id"])
            print(f"{mode} {line['code']}: {len(stations)} gares")

    OUTPUT.write_text(
        "// Fichier généré par tools/build_network.py — ne pas modifier à la main.\n"
        "export const NETWORK = " + json.dumps(lines, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"→ {OUTPUT}")


if __name__ == "__main__":
    main()
