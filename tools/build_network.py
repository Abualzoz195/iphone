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
            print(f"{mode} {line['code']}: {len(stations)} gares")

    OUTPUT.write_text(
        "// Fichier généré par tools/build_network.py — ne pas modifier à la main.\n"
        "export const NETWORK = " + json.dumps(lines, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"→ {OUTPUT}")


if __name__ == "__main__":
    main()
