# Old Klim Caravan Yard — visual target v1

This vertical slice translates the visual clarity of the supplied isometric RPG
reference into an original Realm of Ashes location. The target is not a copy of
the reference architecture or interface.

## Art direction

- One readable hero structure: a caravan body converted into Klim's trade hall.
- A sheltered workshop wing, open spawn plaza and a separate loading yard.
- Chunky slate cliffs frame the play space without changing authoritative
  collision or walkable height.
- Ash-beige ground, charcoal steel, desaturated teal paint, oxidised orange
  rust, cool blue-grey scrub and small amber emissive accents.
- Large colour shapes, bevelled silhouettes, weighted normals and baked/contact
  AO take priority over photoreal micro-detail.

## Runtime budgets

- Repeated prop: one mesh and one material.
- Medium landmark: no more than three render primitives.
- Hero structure: no more than eight opaque primitives plus a separate roof.
- Static environment in one camera view: 80–120 draw calls target.
- Repeated rocks, scrub and yard dressing must be instanced.
- Real-time shadows are reserved for the hero structure, actors and major props.

## Source concept

`old-klim-caravan-yard-concept-v1.png` is an AI-assisted visual target generated
from an original Realm of Ashes brief. It is reference-only and is not rendered
as a game background.
