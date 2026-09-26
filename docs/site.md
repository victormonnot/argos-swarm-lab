# Site navigation and discovery

The site separates discovery from experiment execution. The home page introduces
ARGOS, the catalog exposes all 23 workshops, and each workshop retains its own
model or recording reader, linked views, controls and measured comparisons.

## Routes and modes

- `/`: home, thematic entry points and an explanation of the evidence.
- `/#learning-paths`: three short sequences through existing workshops.
- `/workshops/`: catalog with search, theme, difficulty and execution-mode filters.
- `/consensus/`: distributed average consensus, previously at the root.
- The other 22 workshop routes retain their existing addresses.

Known old root fragments, including `/#experiment`, `/#field-notes` and `/#model`,
redirect to the matching consensus section. This compatibility handler requires
JavaScript; a visible consensus link also remains on the home page. Home fragments
such as `/#about` stay on the home page.

Workshops 01–13 are **Interactive simulation**: computation in the browser over
explicit educational models. Workshops 14–23 are **Recorded replay**: saved
external software execution with synthetic inputs or simulated flight dynamics.
These mode labels are separate from fidelity. Several actual autopilot programs
can run against independent simulated worlds; workshop 23 instead uses one shared
Gazebo world. Neither browser mode connects to live mission execution.

The home specimen is an original schematic illustration: four quadrotors above
a layered wireframe landscape. **Coordination**, **Motion** and **Perception**
select local links, a possible route or illustrative observations. The caption,
question and **Explore the idea** link change together, leading to the actual
consensus, pathfinding or position-estimation workshop.

These are hand-composed visual relations, not planned trajectories, recorded
telemetry or evidence of mission success. Observation rings are a conceptual
illustration, not the sensor model of the linked position-estimation lesson.
Choosing a topic changes only the illustration and its introduction.
Drag the drawing to rotate it, or hold Shift while dragging to move the view.
With the drawing focused, arrow keys rotate and Shift + arrow keys move it.
Double-click, Home or **Reset view** restores the initial viewpoint without
changing the selected topic. Touch dragging rotates the same illustration.

## Learning paths

The home page provides three reading sequences. Every stop links to its existing
workshop; there is no account, progress tracking or access gate.

| Path | Workshop sequence | Preparation |
| --- | --- | --- |
| From one robot to many | 01 Consensus → 03 Task allocation → 04 Decision architectures | No previous workshop |
| From a map to a route | 05 A* → 02 Potential fields → 08 ORCA | No previous workshop |
| From a reading to a belief | 06 Position estimation → 07 Shared estimates → 11 Cooperative localization | 05 A* path planning |

Each path satisfies the recommended workshop prerequisites in that order.
The catalog retains full preparation advice and lets readers choose a different
sequence. These paths introduce browser simulations; the catalog separately
exposes all ten recorded-execution workshops.

## Catalog behavior

`src/site/workshops.js` is the metadata source for IDs, routes, titles, questions,
themes, difficulties, preparation, execution modes and fidelity. It imports no
model, renderer or recording. The catalog combines independent filters and shows
active selections, the matching count and a clear empty state. URL parameters
preserve a selection for sharing and browser Back/Forward:

| Parameter | Meaning | Example |
| --- | --- | --- |
| `q` | Case-insensitive words in workshop metadata | `q=ROS+2` |
| `theme` | Theme key | `theme=localization-and-mapping` |
| `difficulty` | Beginner, intermediate or advanced | `difficulty=beginner` |
| `mode` | Browser computation or recorded evidence | `mode=replay` |
| `start=1` | Beginner workshops with no workshop prerequisites | Workshops 01, 02, 03 and 05 |

Unknown filter values fall back to all values. Search text is displayed as text,
not HTML. A typing session creates one history entry; later edits in the same
session replace it, so Back does not step through every character. Other filter
changes create separate history entries.

Preparation is advice, not an access lock. Each workshop's expandable details
link to recommended and helpful prior workshops and explain its model limits.
The introductory selection excludes workshop 18, which has no prior-workshop
requirement but introduces autopilot and telemetry concepts at intermediate level.

## Static shell and browser enhancement

Vite's `scripts/site-plugin.js` renders common header/footer markers, compact
workshop navigation and catalog HTML in development and in the production build.
The catalog's 23 workshop links, preparation details and home learning paths are
present in the HTML; they remain usable without JavaScript. JavaScript adds
topic selection, illustration controls, filtering, URL restoration,
a mobile menu and a workshop selector. Previous/next and catalog links remain
available when the selector cannot run. Switching workshops starts a fresh
experiment or rewinds a recording.

`src/site/shell.css` styles the common navigation. `src/site/site.css` styles the
home and common editorial elements; `src/site/catalog.css` adds the catalog's
layout. Pearl surfaces, graphite text and steel-blue accents frame discovery.
Experiment controls and their established styles remain separate. Fonts are
served locally with their [license notices](../public/fonts/README.md).
The home page has a static illustration and direct thematic links when its
canvas cannot run. It has no automatic animation or background simulation.

The 25-page build includes home, catalog and the 23 workshops. A root-relative
Vite `base`, such as `/` or `/argos/`, prefixes authored and generated site links
as well as the build's assets.
No domain or hosting-specific canonical URL is embedded. Home and catalog load
neither Three.js nor the large replay datasets; those remain workshop resources.

## Verification

The registry tests check stable unique IDs/routes, preparation references and
cycles, existing lesson/result documents and absence of runtime imports. Browser
tests check topic selection and workshop destinations, camera controls, learning
paths, filter intersections, history/share restoration, empty states, preparation
links, legacy consensus fragments, mobile keyboard navigation, no-JavaScript
discovery and absence of external/heavy requests on editorial pages.
The existing workshop suite retains its numerical, interaction, failure and replay
assertions, with navigation expectations updated for the compact selector.

Run `npm test`, `npm run test:e2e` and `npm run build` as described in the
[README](../README.md#run-locally). These checks do not establish cross-browser,
physical-flight, accessibility-conformance or real-device performance claims.
