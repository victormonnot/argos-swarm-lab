# Private local plan: public educational site

Local working document, excluded through `.gitignore`. Keep implementation
planning, design alternatives and release preparation here; do not stage,
publish or link to this file from public documentation. Public documents describe
the implemented tool, its methods, reproducibility and verified limitations.

Status: **proposed**, 2026-09-25. This document defines a reviewable website
direction; the new pages, metadata, navigation and tools below are not yet
implemented. The existing 23 workshops remain the working product.

## Purpose and audience

Help a curious visitor understand how robots coordinate, navigate, estimate and
execute work, then give a technical reader access to the exact model and evidence.
An introductory explanation should lead to something observable; a technical
explanation should expose assumptions, equations, information boundaries and
sources. Neither audience needs to install robotics software to use the site.

The first public version includes editorial content as well as the workshops:
home, catalog, guided paths, glossary, a sourced timeline, method and sensor
profiles, and one small new interactive explainer. Live mission supervision and
the robustness test bench follow this workstream. Hosting and publication remain
separate decisions.

## Audit of the current product

| Area | Observed implementation | Consequence for the site |
| --- | --- | --- |
| Experiments | 23 HTML entries in `vite.config.js`; separate models or trace readers, page controllers and views. | Preserve the experiments and add discovery around them. |
| Learning content | Questions, predictions, method profiles, controls, comparison cases, equations, references and 23 lesson/result pairs. | Reuse this material; add approachable summaries and connections. |
| Root page | `index.html` opens workshop 1, distributed average consensus. | Give `/` an actual introduction and move workshop 1 to `/consensus/`. |
| Navigation | Every workshop repeats 23 links in `.lesson-switcher`. | Replace the wall of links with a catalog, breadcrumb and compact workshop navigation. |
| Mobile entry | At 390 × 844, the switcher is 569 px high on the three sampled pages; their headings begin around y = 680–702 px. | Put the question, mode and useful first action near the top. |
| Desktop entry | At 1440 × 1000, the same switcher is 221 px high. | A compact common header also helps desktop readers. |
| Presentation | Paper-like light surfaces, dark green text, mint accents and dark experiment panels. Workshops 2–9 already have the refreshed scenes. | Extend the current identity and keep 3D meaning explicit. |
| Discovery | No website catalog by difficulty/prerequisites, guided path pages, glossary, timeline or sensor profile collection. | Introduce structured metadata and a bounded editorial collection. |
| Access | English language metadata, descriptions, skip links, focus styles, semantic tables and 2D alternatives already exist. | Retain them; conduct a broader accessibility review during implementation. |
| Mobile header | Shared CSS hides all but the first lesson-header link at small widths. | New global navigation needs an accessible mobile menu with all destinations. |
| Delivery | Static Vite build, plain JavaScript, SVG and lazily loaded Three.js views. | The existing stack can support the proposed first release. |
| Replay payloads | Recordings are statically imported into replay page entries. The build reports a 15,082.94 kB shared-world JS entry (2,184.13 kB gzip) and a 3,262.02 kB recovery entry (531.84 kB gzip). | Keep editorial pages independent of recordings; plan separate, on-demand replay data loading. These are bundle sizes, not measured load times. |
| Publication preparation | No tracked license, sitemap, dedicated 404 page or CI configuration found; pages have no canonical or Open Graph metadata. | Prepare a release checklist; domain-specific metadata and hosting behavior wait for a publication choice. |
| Documentation | The README is an 853-line technical entry point. The charter still describes several implemented integrations as future candidates. | Keep the detailed references, refresh scope and give public readers a shorter site entry. |

Baseline checks run on 2026-09-25:

- `npm test`: **374/374 pass**.
- `npm run build`: **passes**, with all 23 entries and the existing large-chunk warning.
- `npm run test:e2e`: **182/182 pass** in one full run, using Chromium with
  software WebGL and the Vite development server.
- Browser inspection of `/`, `/movement/` and `/shared-world/` at 1440 × 1000
  and 390 × 844: no page errors or horizontal page overflow in those six visits.
  Desktop and mobile consensus screenshots were visually reviewed.

These checks are an implementation baseline, not a public-release accessibility,
cross-browser or real-device performance certification. No new robotics runs
were recorded for this audit. Existing scientific claims retain the boundaries
in the [experiment guide](experiment-guide.md) and individual result reports.

## Make execution and fidelity independently visible

Use two fields instead of one overloaded “simulation” or “live” indicator.

| Workshops | Browser mode | What the evidence represents |
| --- | --- | --- |
| 1–9 | **Interactive simulation** | Abstract agreement, planar motion or static information/planning models. |
| 10 | **Interactive simulation** | Three-dimensional point kinematics, including altitude; no flight dynamics. |
| 11–12 | **Interactive simulation** | Planar estimation and synthetic sensor measurements. |
| 13 | **Interactive simulation** | A browser-computed optimizer over a synthetic historical trajectory, not an external process recording. |
| 14–17 | **Recorded replay** | Actual ROS 2 software execution with synthetic scalar, position or heartbeat data. |
| 18, 20 | **Recorded replay** | Actual autopilot software with built-in SITL vehicle dynamics. |
| 21–22 | **Recorded replay** | Multiple actual autopilots with independent SITL physical worlds, shown in a supplied common frame. |
| 19, 23 | **Recorded replay** | Actual autopilot execution coupled to external Gazebo physics; three bodies share one world in workshop 23. |
| None currently | **Live execution** | Reserved for a future interface attached to an actual running simulator. |

Cards show the mode; workshop introductions also state the fidelity and source
of data. A recording page says “Playing a recording” with recording provenance,
not “Live.” Model time, recorded time and playback speed remain distinct.
Replaying workshop 1's in-memory history does not change its origin into external
execution evidence. Optional local Docker recorders produce new files; they do
not make the browser a live controller.

Keep essential limitations visible in both reading depths. For example, a
quadrotor drawn above a planar model does not create vertical avoidance; a task
claim is not task completion; an ACK is not evidence of completed flight.

## Site structure

Use four primary navigation destinations: **Workshops**, **Learning paths**,
**Field guide**, **Timeline**. The brand leads home. Glossary is a persistent
utility link and part of Field guide; About, sources and code belong in the footer.

```text
/                           Home
/workshops/                 Searchable, filterable catalog
/learning-paths/            Four guided paths
/learning-paths/<slug>/     One path and its recommended steps
/field-guide/               Methods, architectures and sensors
/field-guide/<slug>/        One explanatory profile
/glossary/                  Searchable definitions with stable term anchors
/timeline/                  Eight sourced events, list and timeline views
/tools/lidar/               Idealized 2D LiDAR explainer
/about/                     Purpose, evidence conventions, sources and scope
/consensus/                 Workshop 01, moved from /
/movement/ ... /shared-world/ Existing workshop URLs retained
```

Do not move the other 22 workshop URLs solely for symmetry. IDs 01–23 remain
stable identifiers, not a requirement to finish the entire sequence in order.
Known old consensus fragment links such as `/#experiment`, `/#field-notes` and
`/#model` need an explicit compatibility mapping to `/consensus/` with the same
fragment. A server redirect from all of `/` would prevent the home page from
working; provide a small known-fragment handler and a visible consensus link.
Inventory existing anchor targets before migration and preserve lesson anchors.

### Home page

1. A plain-language promise: **“How do robots work together?”** Supporting copy:
   “Explore coordination, navigation and autonomy through experiments you can inspect.”
2. Two clear entries: **Explore workshops** and **Start a guided path**.
3. A lightweight, captioned illustration or still from an existing workshop.
   No autoplay flight scene, automatic WebGL initialization or recording download.
4. Three starting questions linking to consensus, path planning and task allocation.
5. Four guided paths, each described by its learning outcome.
6. A short explanation of interactive simulations versus recorded replays.
7. A LiDAR field-guide feature and one sourced timeline event, linking discovery
   to the broader context. These sections appear when their content is delivered.
8. A concise statement about reproducibility, limitations and access to sources.

### Catalog and metadata

Every workshop gets one metadata record: `id`, `slug`, `url`, `title`,
`question`, `summary`, `primaryTheme`, `tags`, `difficulty`, `prerequisites`,
`helpfulBefore`, `mode`, `fidelity`, `learningOutcomes`, `limitations`,
`relatedTerms`, `relatedProfiles`, `lessonBrief` and `resultsReference`.
Records reference content and routes, never import simulation or trace modules.

The catalog supports text search and independent theme, difficulty and mode
filters. Prerequisite links and a “Start here” filter for workshops with no
recommended workshop prerequisites make entry requirements inspectable. Display
active filters, result count, a useful empty state and reset. Encode filters in
URL parameters so browser Back and shared links reproduce the selection.
Keep all 23 links readable in the initial HTML without JavaScript.

The following classification is an editorial proposal. **Beginner** means the
basic experiment needs no prior workshop; **Intermediate** introduces a small
set of linked concepts; **Advanced** combines substantial estimation, protocol
or integration assumptions. Prerequisites are recommendations, never access
locks. Mathematical background belongs in each optional technical section.

| ID | Current route | Theme | Proposed level | Recommended preparation |
| --- | --- | --- | --- | --- |
| 01 | `/` → `/consensus/` | Coordination | Beginner | None |
| 02 | `/movement/` | Motion & navigation | Beginner | None |
| 03 | `/mission/` | Coordination | Beginner | None |
| 04 | `/architecture/` | Coordination | Intermediate | 01, 03 |
| 05 | `/pathfinding/` | Motion & navigation | Beginner | None |
| 06 | `/localization/` | Localization & mapping | Intermediate | 05 |
| 07 | `/fusion/` | Localization & mapping | Advanced | 06; 01 helpful |
| 08 | `/orca/` | Motion & navigation | Intermediate | 02; 05 helpful |
| 09 | `/cbba/` | Coordination | Advanced | 01, 03; 04 helpful |
| 10 | `/behavior/` | Coordination | Intermediate | 03 |
| 11 | `/cooperative/` | Localization & mapping | Advanced | 06; 07 helpful |
| 12 | `/slam/` | Localization & mapping | Advanced | 06 |
| 13 | `/pose-graph/` | Localization & mapping | Advanced | 12 |
| 14 | `/ros2/` | Distributed software | Intermediate | 01 |
| 15 | `/qos/` | Distributed software | Intermediate | 14 |
| 16 | `/restart/` | Distributed software | Intermediate | 15 |
| 17 | `/middleware/` | Distributed software | Advanced | 14, 15 |
| 18 | `/sitl/` | Simulated flight & missions | Intermediate | Autopilot and telemetry primer |
| 19 | `/gazebo/` | Simulated flight & missions | Advanced | 18 |
| 20 | `/failsafe/` | Simulated flight & missions | Intermediate | 18; 16 helpful |
| 21 | `/fleet/` | Simulated flight & missions | Intermediate | 03, 18 |
| 22 | `/recovery/` | Simulated flight & missions | Advanced | 10, 21 |
| 23 | `/shared-world/` | Simulated flight & missions | Advanced | 19, 22 |

### One workshop, two reading depths

Keep a single address and a single run. A short **Start here** section introduces
the question, one concrete analogy, three actions to try and one outcome to
inspect. **Go deeper** links to equations, assumptions, technical inspectors,
source references and reproducibility instructions on the same page.

This is progressive disclosure, not two implementations or an obligatory
“beginner/expert” account setting. Existing controls remain available, the
experiment can be reached directly, and changing reading depth never changes
the model, parameters, seed, current time or replay cursor. Do not hide failures
or information boundaries behind the technical section.

## Bounded editorial content for version 1

### Four guided paths

| Path | Main steps | Observable learning outcome |
| --- | --- | --- |
| **First steps in multi-robot coordination** | 01 → 02 → 03 → 04 | Distinguish agreement, motion, assignment and decision authority. |
| **Navigation and uncertain maps** | 05 → 06 → 12 → 13 | Distinguish a route, a position estimate, a map and retrospective trajectory correction. |
| **Reliable information between programs** | 01 → 14 → 15 → 16 → 17 | Distinguish numerical agreement, message delivery, freshness, suspicion and historical retention. |
| **From commands to a simulated fleet** | 18 → 19 → 21 → 22 → 23 | Follow command admission, measured completion, task ownership and shared physics. |

The fleet path includes explicit preparatory links to 03 before 21 and to 10
before 22. Short reminders explain the relevant concepts but do not silently
claim those prerequisites are already covered. Branch links surface 07, 08, 09,
11 and 20 without lengthening every main path. Each step supplies a checkpoint
question and a next link. Durations, if added, are labeled editorial estimates
until tested with readers. Account creation, certificates and synchronized
progress are outside version 1; a local checklist can be added later.

### A glossary with 36 core entries

- Foundations: agent, swarm, algorithm, decision architecture, centralized,
  decentralized, distributed software, communication topology.
- Decisions and actions: consensus, task allocation, finite-state machine,
  Behavior Tree, path planning, collision avoidance.
- Knowledge: state estimate, ground truth, uncertainty, covariance, correlation,
  odometry, Kalman filter, SLAM, data association, loop closure.
- Communication: node, topic, QoS, freshness / Age of Information, heartbeat, epoch.
- Execution: autopilot, MAVLink, SITL, simulation, recorded replay, live execution.

Each entry has a short definition, an example, a common confusion, related terms
and an applicable workshop link. Define LiDAR, IMU and GNSS directly on their
sensor profiles and make those titles searchable from the glossary. Keep
definitions centralized so catalog cards and workshop helpers do not diverge.

### Six method profiles and four sensor profiles

Method profiles: **Consensus**, **Task allocation**, **Planning and local collision
avoidance**, **State estimation and SLAM**, **Behavior Trees and FSM**,
**Decision architectures**. Grouped profiles compare roles and assumptions;
they must not imply that the grouped methods are interchangeable.

Sensor profiles: **LiDAR**, **Cameras and depth cameras**, **IMU**, **GNSS**.
Flight controllers and companion computers get a concise distinction in the
autopilot primer; dedicated hardware profiles can follow version 1.

Every profile answers: What problem does it address? How does it work? What data
or decisions does it produce? What are its strengths? What can make it fail?
Where is it useful? Which workshop illustrates a related concept, and what does
that workshop actually model? Add primary sources and a verification date.
The initial collection explains technology; it is not a purchasing guide or a
ranking of brands.

For LiDAR, start with **pulsed time-of-flight**: `distance = c × roundTripTime / 2`,
defining units and the idealized propagation assumption. A point cloud is a set
of returns; localization, map construction and obstacle decisions are subsequent
processing. Explain coverage, angular sampling, occlusion, measurement age and
the dependence of returns on target and environmental conditions. Do not attach
a universal range, accuracy or weather threshold to the technology.

Primary starting references:

- [USGS LiDAR glossary](https://www.usgs.gov/ngp-standards-and-specifications/lidar-base-specification-glossary)
  for time-of-flight and mapping terminology.
- [NOAA: What is LIDAR?](https://www.ngs.noaa.gov/INFO/facts/lidar.shtml)
  for point-cloud mapping and the role of position/orientation in airborne surveys;
  GNSS is not a required component of every LiDAR device.
- [Li et al.: What happens to a ToF LiDAR in fog?](https://arxiv.org/abs/2003.06660)
  for experimental evidence under controlled fog, with sensor-specific limits.
- [Lin et al.: R2LIVE](https://arxiv.org/abs/2102.12400)
  for a research example of LiDAR, camera and inertial fusion, not a universal guarantee.

Workshops 12 and 13 do **not** process LiDAR returns, extract visual features or
solve automatic data association. Their links from these profiles must say so.
Complete comparable primary-source reviews for the other profiles when authored.

### Eight timeline entries

Use **Research**, **Project release**, **Demonstration** and **Product announcement**
as distinct event types. An entry may have a secondary tag. The first collection
is a curated set of connections to the lab, not a comprehensive history or a
ranking of achievements. Source discovery was performed on 2026-09-25.

| Event date | Type | Bounded claim and primary source | Boundary / connection |
| --- | --- | --- | --- |
| 1986 | Research | Khatib publishes [Real-Time Obstacle Avoidance for Manipulators and Mobile Robots](https://khatib.stanford.edu/publications/pdfs/Khatib_1986_IJRR.pdf). | Date of this IJRR paper, not a claim of invention in 1986; [the lab bibliography](https://khatib.stanford.edu/publications.html) also lists 1985 work. Connect to 02. |
| July 1987 | Research | Reynolds describes [Flocks, Herds, and Schools: A Distributed Behavioral Model](https://www.red3d.com/cwr/papers/1987/boids.html). | Behavioral animation, not a physical robot swarm; distinguish local motion rules from consensus. No Boids workshop is implemented. |
| 2005-10-08 | Demonstration | Stanley completes and wins the DARPA Grand Challenge; the team describes the system in [its 2006 paper](https://robots.stanford.edu/papers/thrun.stanley05.pdf). | Bounded off-road competition with supplied route constraints, not general driving autonomy. Connect to sensing and planning concepts. |
| July 2012 | Demonstration / Research | [Towards A Swarm of Agile Micro Quadrotors](https://www.roboticsproceedings.org/rss08/p28.html) reports a team of 20 micro quadrotors. | Publication date; known environments and external localization are explicit. Do not label a video with an unverified original date. |
| 2014-08-15 | Demonstration / Research | Kilobot programmable self-assembly is published; [Harvard's institutional account](https://seas.harvard.edu/news/self-organizing-thousand-robot-swarm) describes the thousand-robot experiment. | Planar robots, predefined shapes and seed robots; the institutional announcement is dated August 14, distinct from the paper. |
| December 2017 | Project release | [ROS 2 Ardent Apalone](https://docs.ros.org/en/crystal/Releases/Release-Ardent-Apalone.html), the first non-beta release. | Communication/software infrastructure, not an autonomy algorithm. Connect to 14. |
| 2021-04-19 | Demonstration | [NASA Ingenuity](https://science.nasa.gov/mission/mars-2020-perseverance/ingenuity-mars-helicopter/) achieves powered, controlled flight on another planet. | One aircraft, not a swarm. Relate autonomy and delayed observation; do not equate lab simulation with mission validation. |
| 2023-01-10 | Product announcement | [Livox announces Mid-360](https://www.livoxtech.com/news/mid360_launch), a compact LiDAR intended for mobile robots. | Historical manufacturer announcement, not an independent benchmark or a claim about current availability. Connect to the LiDAR profile. |

Each entry stores the event date and precision, source publication date,
organization/authors, event type, supported claim, limitation, primary URL,
related concepts/workshops and `checkedAt`. Distinguish a source's explicit
statement from an editorial connection. Manufacturer claims remain attributed.
Verify page access and exact dates again when publishing the entries; the ROS
release notes were search-index readable but protected on direct access during
source discovery. An inaccessible source needs an accessible primary alternative
or an explicit access note. No “first” claim beyond what its source supports.

The default view is a readable chronological list; a visual timeline and type
filters enhance it. Do not require horizontal dragging or hover to read events.

### One new interactive tool, plus reuse of existing inspectors

**How a LiDAR sees** is the only additional simulator proposed for version 1.
It uses an explicitly idealized 2D first-return ray model with a small fixed scene.
Controls change range, angular spacing and one occluder. Show rays, detected
points and an example of geometry hidden behind a surface. A numerical/text
alternative explains the selected ray. Computed geometry remains independent
of SVG rendering, with meaningful checks for intersections, occlusion and range.
No weather, material response, noise, hardware driver or SLAM is implied.

**Who knows what?** can be a guided exercise linking to workshop 04's existing
observer inspector. **Was the task completed?** can link to ACK/telemetry/task
evidence in 18 and 21. These reuse current capabilities. A richer sensor selector,
standalone evidence explorer and prerequisite graph are follow-up candidates,
not requirements that postpone the first release.

## Visual requirements and open design choices

The visual identity remains to be defined before implementing the new site
shell. Palette, typography, imagery and overall composition are open choices.
The following requirements guide design exploration without prescribing a
particular editorial or technological appearance.

Two candidates are available for comparison: a dark, immersive composition with
cyan accents and a prominent workshop scene, and a light, contemporary composition
with cobalt accents and a wider scene below the headline. Both use clear
sans-serif typography, the same learning content and explicit execution-mode
labels. Any scene still is identified as an image from a paused recording.
Neither candidate is a selected implementation target yet.

| Element | Proposed treatment |
| --- | --- |
| Surfaces and color | Palette and light/dark treatment remain open. Verify contrast in the selected design. |
| Experiment surfaces | Preserve readable state labels, controls and evidence while integrating the chosen identity. |
| Typography | Typeface choices remain open. Distinguish prose, controls and numerical evidence clearly. |
| Reading scale | Target 16–18 px body text, comfortable line spacing and about 65–75 characters per prose line. Keep essential labels comfortably readable. |
| Layout | Short shared header, clear page title, generous editorial spacing, compact workshop metadata, bounded experiment workspace. |
| Imagery | Existing experiment captures and explanatory diagrams, accurately captioned. Avoid implied field deployment from decorative imagery. |
| Mode labels | Text and an icon/shape distinguish simulation and replay; color is supplementary. A green status dot must not imply a live connection. |
| Small screens | Stacked content, accessible expandable navigation, reachable experiment controls and contained wide technical tables. |
| Motion | Explicit play controls, no hero autoplay, reduced-motion support, useful 2D and textual alternatives. |

Aim for [WCAG 2.2 AA](https://www.w3.org/WAI/WCAG22/quickref/) across the new
navigation/content and audit existing interactions. Keyboard operation, visible
focus, zoom/reflow, non-color cues and readable alternatives need actual checks;
the current baseline is not a conformance claim. Do not require WebGL to browse
the site, read a result or operate the supported 2D workshop.

## Implementation strategy

Retain plain HTML/CSS/JavaScript and Vite's
[multi-page build](https://vite.dev/guide/build.html#multi-page-app).
No framework migration, backend, CMS or new dependency is necessary to start.
Review official documentation before introducing one for a concrete later need.

- Create a small data-only workshop registry and reusable site styles. Generate
  repeated static navigation and catalog markup at build time, also in local
  development, using a bounded script/template layer. Keep written content in
  reviewable repository files; do not build a general publishing framework.
- Scope new site styles so experiment-specific layouts and selectors retain
  their behavior. Preserve model/view separation and lazy Three.js loading.
- Home, paths, profiles, glossary and timeline must not import workshop
  controllers, Three.js or recordings. Their main copy and links are static HTML.
- Load a recording when requested, separate from its page shell. Preserve the
  exact trace and validators; show loading, error and retry states, and keep
  import functional. Do not trade away evidence to make a payload smaller.
- Keep route construction base-aware. The current root-absolute URLs need a
  coherent strategy if hosting later uses a project subpath. Domain-specific
  canonical URLs, sitemap origin, redirects and cache rules wait for that choice.
- Provide one source of metadata for catalog, prerequisites, path steps and mode
  labels. Validate duplicate IDs, missing routes, unknown prerequisites, cycles
  and broken content references.

Provisional performance budget for each editorial entry: at most **250 kB gzip
of first-party HTML + CSS + JavaScript**, with images budgeted separately, and
**zero recording or WebGL-library requests** before a workshop is opened.
This is a proposed budget, not a measured current result. Measure the built
pages, loading states and a throttled mobile scenario before declaring readiness.

## Delivery stages and acceptance

Each stage should be locally reviewable and retain the previous stage's behavior.
Intermediate stages are previews; **the proposed version 1 includes stages 1–5**.
Deployment is a later explicit action, not an automatic result of passing checks.

| Stage | Concrete delivery | Acceptance before continuing |
| --- | --- | --- |
| **1. Home and discovery** | Shared header/footer; home; metadata for all 23 workshops; catalog with search/theme/difficulty/mode/prerequisite entry points; `/consensus/` migration; compact workshop navigation. | All workshop URLs and known anchors work; catalog/back/filter behavior is correct; keyboard/mobile navigation works; experimental assertions remain intact; home/catalog request no traces or Three.js. |
| **2. Guided learning** | Four paths, 36 glossary entries, accessible intro and technical anchors across all 23 workshops; explicit preparation for the fleet path. | Every path step has a question, expected observation and next link; reading depth preserves experiment state; prerequisites resolve; failures and mode labels remain visible. |
| **3. Context and sources** | Six method profiles, four sensor profiles and eight timeline entries, cross-linked to relevant workshops and terms. | Each factual claim has an appropriate primary source; dates and announcement/publication types are explicit; sensor presence is not misrepresented; no dead placeholder pages. |
| **4. LiDAR explainer** | One small geometry tool integrated into its profile and linked from the glossary. | Known ray/segment intersections, first-return occlusion and range limits checked; controls and text alternative work with keyboard; simplified-model limits visible. |
| **5. Release preparation** | Replay payload separation; accessibility/performance review; error/404 behavior; short public README entry; metadata and build checks; review of content/image/recording rights and license choice. | Production navigation and representative simulations/replays pass; all existing regressions run after integration; cross-browser/mobile checks documented; no private content in output; source freshness reviewed. Domain-dependent checks remain explicitly pending. |

The next recommended implementation slice is **stage 1**, with one bounded
review of home, catalog and navigation before expanding the editorial collection.
Do not change the algorithms, recording formats or numerical evaluators as part
of that slice. Update tests that encode the old 23-link switcher deliberately;
retain their underlying navigation coverage and experimental assertions.

Release verification should include a production-build crawl of all routes,
catalog URL round-trips, glossary anchors, path prerequisites, 2D/3D state
continuity, no-WebGL behavior, replay imports and failure cases, keyboard/focus
checks, 320–390 px reflow and desktop views. The current browser suite is Chromium;
Firefox and WebKit checks need to be introduced and actually run before any
cross-browser claim. No new test is needed merely to mirror prose in a document.

## Decisions reserved for publication

- Hosting provider, domain, root versus subpath deployment, preview policy and
  the exact deployment process.
- License for project code and original content; attribution and permitted use
  of any third-party media or datasets. Linking a source does not license its images.
- Maintenance/contact identity and source-review cadence. Use checked dates and
  scoped claims rather than an unmaintainable promise of exhaustive coverage.
- Analytics only if a concrete need is established; no account or tracking
  infrastructure is needed for this first site.

The release can be prepared and reviewed locally while these choices remain
open. Live missions, physical deployment, systematic robustness campaigns,
automatic sensor buying recommendations and an exhaustive robotics encyclopedia
are outside this first public version.
