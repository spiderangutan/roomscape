# Roomscape

A calm, browser-based home-planning studio. Plan a home in a scaled **2D editor**, arrange
rooms in a **whole-home plan**, and work in an **isometric 3D view**. Everything is saved
automatically in the browser, so a project survives a refresh.

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # typecheck + production build
npm run check      # model + state checks (geometry, scenes, migration)
```

## How it works

- **One shared model.** Both views render from the same room document, so a change made in
  either view appears immediately in the other and is saved.
- **Two scopes.** Edit one room (2D or 3D), or switch to **Whole home** to see every room
  together. Rooms carry a saved position and rotation, can be dragged in the home plan, and
  touching rooms share a single wall in the 3D home view.
- **3D is interactive.** Drag furniture to move it across the floor, then use the floating
  bar to rotate, duplicate, delete or recolour it. Orbit with a drag, pan with shift-drag or
  right-drag, zoom with the wheel; the camera eases smoothly.
- **Units.** All measurements are stored in millimetres. Fields accept mixed input —
  `12 ft 6 in`, `5'6"`, `2.4 m`, `85cm`, `900` — and display in the project's chosen unit
  (feet & inches, inches, metres, centimetres or millimetres).

## What you can do

- Create, rename, open and delete **projects**; the sample "Maple Street Apartment"
  ships with five furnished rooms.
- Add, rename, duplicate, reorder and delete **rooms**; create a room by entering its
  length and width, then change either at any time.
- **Rotate a room in 90° steps** — walls, doors, windows and furniture turn together and
  keep their own dimensions; rotate individual furniture separately.
- Move, rotate (15° steps with the handle, 90° with the buttons), resize, duplicate and
  delete **furniture** in either view, with optional grid snapping and keyboard nudging.
- Choose each item's **colour** from a muted palette; the same colour is used in 2D and 3D.
- Add **doors and windows**, then drag them along a wall and edit wall, offset, width,
  height, sill and — for doors — **hinge side and swing direction**. The leaf and swing arc
  match in 2D and 3D.
- **Custom items**: name, width/depth/height, box / L-shape / round, and a muted colour.
  L-shapes keep a constant leg thickness when resized, with a separate thickness field.
- **Fit feedback**: overlaps, furniture outside the walls and blocked openings appear as a
  small indicator you can open. A brief note appears next to the item you just moved.
- **Undo / redo** up to 80 steps, plus persistent **autosave** with a visible status.

Older saves are migrated on load: rooms gain a whole-home position, items gain a default
colour and door openings gain hinge/swing defaults, without losing any saved layout.

## Layout

```
src/
  lib/
    units.ts      measurement parsing/formatting (mm storage)
    geometry.ts   footprint maths, openings, fit checks, room rotation
    catalog.ts    starter furniture catalog
    parts.ts      simple block models used by the 3D preview
    scene3d.ts    builds the isometric scene from a room
    store.ts      state, undo/redo history, localStorage autosave
    sample.ts     the sample apartment
  components/
    Editor2D.tsx  SVG room canvas: grid, walls, openings, furniture, fit indicator
    Plan2D.tsx    SVG whole-home plan: drag and rotate rooms, open one to edit
    View3D.tsx    interactive isometric canvas: picking, floor dragging, smooth camera
    ...           toolbar, panels, dialogs and fields
```

The 3D views are drawn with a small custom painter's-algorithm renderer (no 3D dependency):
convex blocks are projected orthographically, near-facing walls are cut away so the room
reads clearly, faces are lit once at draw time with a soft key light, and adjacent rooms
collapse their doubled walls.
