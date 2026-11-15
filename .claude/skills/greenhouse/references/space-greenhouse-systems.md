# Space greenhouse systems

Reference notes for the `greenhouse` kit: what real closed-loop habitats do, the numbers that make a dome and a grow row read correctly, and where the model simplifies. Use these as design targets, not as a pressure-vessel calculation.

## What the precedents teach

| Programme | What it was | Numbers worth keeping | Lesson for the kit |
| --- | --- | --- | --- |
| **BIOS-3** (Krasnoyarsk, from 1972) | a closed ecological system inside a sealed concrete building, with higher plants under artificial light | about 315 m³ and 14 × 9 m of floor; four compartments; 20 kW xenon lamps over the phytotrons; crews of two to three for months at a time | artificial light, a sealed envelope and a small crew are enough to make a complete food loop; the lamp wall is part of the architecture |
| **CELSS** (NASA, 1980s onward) | Controlled Ecological Life Support System studies: grow food, recycle air and water, close the loop | crop area, lighting power, biomass and water recycling sized per crew member; hydroponics as the baseline | the greenhouse is a life-support subsystem, not a farm: its output is oxygen, water and food together |
| **Biosphere 2** (Arizona, 1987–1991) | the largest closed ecological system built: 12,700 m² of floor under a steel and glass space frame | 3.14 acres; eight crew for two years from 1991; the farm produced 83 % of the diet in the first mission; 40–50 % of outside light reached the interior; oxygen fell from 20.9 % to 14.5 % over 16 months; daily CO₂ swings around 600 ppm; concrete absorbed CO₂ | glass alone is not a life-support system; light transmission, soil respiration and CO₂ chemistry dominate the design; the envelope and the concrete are active parts of the loop |
| **MELiSSA** (ESA, from 1989) | a four-compartment artificial ecosystem: waste liquefaction, photoheterotrophy, nitrification, photoautotrophy (algae and higher plants) | about 3.56 kg of drinking water and 26 kg of hygiene water per person per day; thermophilic waste digestion at 55 °C; pilot plant at the Universitat Autònoma de Barcelona since 2009 | nutrients come from waste, not from a bag; a greenhouse needs a visible nutrient core and a return path, not just a water tank |
| **EDEN ISS** (Neumayer III, Antarctica, from 2018) | a hydroponic research module beside a polar station, testing food production for Mars | a sealed, insulated module with artificial light; crops grown through the polar winter | the small pressurised module with a vestibule, a service wall and dense rows is a better precedent than a giant conservatory |
| **ISS Veggie / Advanced Plant Habitat** | small LED-lit plant chambers on the station | red and blue LEDs, a contained root module, airflow and a light hood | the lamp bar, the tray and the airflow gap are the readable parts at small scale |

The useful pattern across all of them: **a sealed envelope, an airlock, a nutrient loop, artificial light and dense rows**. The kit is organised around those five things.

## The closed loop

A crew of one needs, roughly:

- **oxygen** about 0.84 kg per day, and produces about 1 kg of carbon dioxide
- **drinking water** about 3.5 kg per day, and much more for hygiene
- **food** about 0.6–0.8 kg dry mass per day, depending on diet and energy
- **crop area** a few tens of square metres per person for a mostly plant-based diet; the exact number depends on light, crop and how much of the diet is grown

A greenhouse closes those loops only if it also has:

- a **nutrient core** that receives waste and returns solution
- a **drain** from every tray back to the core
- **air circulation** through the canopy, not just a sealed volume
- **make-up water** and a **gas buffer** for the days when the crop and the crew are out of phase

The kit shows the first two explicitly (core, manifolds, tank, drain stub) and leaves the air handling to the `pipes` and `lighting` skills. A dome with no return path is a conservatory, not a life-support system.

## Hydroponics

Three systems are worth knowing:

- **NFT (nutrient film technique)**: a shallow film, 1–2 mm, flowing down a channel at a slope of about 1–2 %. Roots sit in the dark channel and the film keeps them wet. This is what the kit's U-channel trays represent.
- **DWC (deep water culture)**: roots suspended in a deep, aerated tank. Reads as a tank with rafts, not as a row.
- **Substrate / drip**: a slab of rockwool, coir or perlite with a drip line and emitters. This is the kit's substrate slab and drip manifold. It is the most forgiving system and the easiest to read in a cutaway.

Design targets for leafy crops:

| Variable | Target |
| --- | --- |
| Solution temperature | 18–24 °C |
| pH | 5.5–6.5 |
| EC | 1.2–2.4 mS/cm, lower for seedlings, higher for fruiting crops |
| Dissolved oxygen | above 5 mg/L |
| Flow per channel | enough to keep a film across the root mat; a few litres per minute, not a torrent |
| Slope | 1–2 % along the channel |
| Root-zone | dark, humid, and not standing in stagnant water |

The kit's tray depth (130 mm), substrate (55 mm) and manifold (one branch per tier) are in the right range for a substrate/drip row. If you need a visible NFT film, model a thin reflective strip in the channel and keep the substrate out.

## Light

- **PPFD** for lettuce and herbs: about 200–400 µmol m⁻² s⁻¹ at the canopy. Fruiting crops want more.
- **Photoperiod**: 16–18 h for leafy crops; a dark period is part of the design.
- **DLI**: about 12–20 mol m⁻² day⁻¹ for lettuce. DLI is PPFD × seconds of light, so a lower PPFD for longer can do the same job.
- **Spectrum**: red (around 660 nm) and blue (around 450 nm) do most of the work; a small amount of green and far-red makes the crop look alive and shapes the canopy. The kit's magenta diffusers are a readable stylisation, not a spectrum claim.
- **Distance**: bar to canopy about 0.2–0.5 m for a low-power LED bar; too close scorches, too far wastes light. The kit uses 0.17 m below the next tray, which forces a tier pitch larger than the canopy height.
- **Heat**: LEDs put most of their power into heat at the fixture. In a sealed dome that heat is part of the HVAC load; the crown lantern and the catwalk-level air handling are not decoration.

Do not put a real light in every bar. Use emissive diffusers for the look and one or two shadow-casting lights for the pools on the floor and the core; see the `lighting` skill.

## Atmosphere and pressure

- **Total pressure**: about 101 kPa for a shirtsleeve habitat; lower pressures are possible with a higher oxygen fraction, but the kit assumes a full atmosphere.
- **Oxygen**: about 21 kPa partial pressure.
- **Carbon dioxide**: 400–1,200 ppm (0.04–0.12 %) is a working range for plants; above that, growth and crew comfort both suffer. Biosphere 2's daily swing was around 600 ppm, which is a useful reminder that a sealed greenhouse breathes.
- **Relative humidity**: 50–70 % in the crop zone; condensation on cold glazing is normal and must be drained.
- **Temperature**: 20–24 °C by day, 16–20 °C at night for many crops; the root zone is cooler than the air.
- **Air speed**: 0.2–0.5 m/s through the canopy, enough to move the boundary layer without damaging leaves.
- **Ethylene and other volatiles**: keep them low; ripe fruit and stressed plants produce them, and a sealed volume accumulates them. This is a real reason for the vent lantern and the return air path.
- **Leak rate**: Biosphere 2 achieved less than 10 % per year, which is exceptional. A space habitat airlock is a pressure boundary, not a door; the kit's vestibule with two doors is the minimum readable version.

Pressure is why the envelope is an **ellipsoid with ribs and a tension ring**, not a flat-roofed shed. A pressure vessel wants continuous curvature and a ring that takes the thrust. The kit's rib-and-panel system is a stylised version of a real prefabricated glazing structure.

## Structure and glazing

- **Shape**: an ellipsoid of revolution is efficient in hoop and meridian stress and gives a shallow crown; a hemisphere is taller for the same floor and wastes volume. The kit's `rise` of 0.8 R is a compromise between pressure shape and usable height.
- **Ribs**: meridian ribs carry the panels and stiffen the shell; ring beams tie them. Ribs land on a tension ring at the base and a compression ring at the crown.
- **Glazing**: glass is heavy and brittle; acrylic and polycarbonate are lighter and tougher; ETFE foil cushions are the lightest and are common on terrestrial biodomes. All of them transmit about 85–92 % of visible light when clean, and much less when condensation, dust or shading is present.
- **Foundations**: a tension ring on a concrete plinth, with anchor bolts, is the readable base detail. On regolith or ice, the plinth would be a sintered or piled ring; the kit keeps the concrete version because it reads at a glance.
- **Radiation**: glass does not solve galactic cosmic rays or solar particle events. A Mars or lunar greenhouse needs regolith overburden, a buried arch or a storm shelter. The kit's transparent dome is a dramatic choice; if the scene is hard science fiction, put the dome under a shield or make it a terrestrial research station.

## Layout maths used by the kit

For a dome of radius `R`:

- inner ring radius `0.35 R`; outer ring radius `0.68 R`
- bay angle `2π / bays`; chord `2 r sin(π / bays)`
- row length `clamp(chord × 0.78, 2.2, 10)`, rounded to 0.5 m
- two rows per bay at `1.15 m` centres, row width `0.9 m`, leaving a `0.25 m` gap inside the pair and a service aisle between bays
- door bay skipped within about half a bay of the airlock axis
- inner rows one tier lower than outer rows, so the section steps down toward the core

The 0.25 m gap inside a pair is deliberate: the pair is a double bed serviced from the aisles on either side, not a walk-through. If you want a walking aisle between every row, set `rowsPerBay: 1` and raise `rowPitch`, or lay out rows manually.

The catwalk sits at about half the crown height (`clamp(0.5 H, 3.3, 5.2)`), inside the shell radius at that height, with a 1.05 m deck. Its brackets reach back to the shell, so the walkway is never a floating ring.

## What the kit simplifies

- **No pressure analysis.** The ribs and ring are proportioned to look right, not to hold a calculated differential. Do not use the geometry as an engineering model.
- **No HVAC ducts, fans, condensers or airlocks beyond the vestibule.** Add them with `pipes` and your own geometry.
- **No real crop simulation.** Plants are fixed templates at a spacing; they do not grow, bolt, flower or die. `crop: 'none'` is the clean state.
- **No real lights.** The diffusers are emissive; lighting the scene is the caller's job.
- **No water simulation.** The manifold, emitters and tank are geometry; the feed points are connection points, not a flow model.
- **No radiation shielding, no regolith, no exterior site.** The dome is a building, not a landscape.
- **Pipe distribution is delegated.** The core has a ring main and risers, but the mains and branches to the rows come from the `pipes` kit. This is deliberate: one pipe system, one set of rules, no duplicated geometry.

## Sources

- BIOS-3: [Wikipedia](https://en.wikipedia.org/wiki/BIOS-3), summarizing the Krasnoyarsk closed ecological system and its phytotrons.
- CELSS: [NASA technical reports on controlled ecological life support](https://ntrs.nasa.gov/search?q=CELSS), and the CELSS bibliography.
- Biosphere 2: [Wikipedia](https://en.wikipedia.org/wiki/Biosphere_2), including the 1991–93 closure, the 83 % food figure, light transmission and the oxygen/CO₂ record.
- MELiSSA: [Wikipedia](https://en.wikipedia.org/wiki/MELiSSA) and the [MELiSSA Foundation](https://www.melissafoundation.org), including the four-compartment loop and the Barcelona pilot plant.
- EDEN ISS: [Wikipedia](https://en.wikipedia.org/wiki/Neumayer_Station_III#EDEN_ISS_greenhouse) and DLR mission reports.
- ISS plant hardware: [NASA Veggie](https://www.nasa.gov/veggie) and Advanced Plant Habitat pages.
- Hydroponic and lighting targets: standard horticultural ranges (EC, pH, PPFD, DLI); treat them as starting points and tune to the crop and the scene.
