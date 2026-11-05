### 3D models (Blender) — especially "model this from a reference image"
Blender 5.2 is on PATH as `blender`. Build the model with a Python script (bpy) so it is reproducible:
```bash
blender -b -P build_model.py          # your script: creates objects, materials, saves model.blend + exports model.glb
blender -b model.blend -P <skill>/scripts/blender_turnaround.py -- --out .proof/render
node <skill>/scripts/compare.mjs ref.png .proof/render/view_035.png --out .proof/compare.png --label "3/4"
```
`blender_turnaround.py` renders front/3-4/side/back with neutral studio light + `contact_sheet.png`
and prints vertex/face count, size and materials. `compare.mjs` puts reference and render side by side
with a diff and a 0–100 score. **Loop at least 3 times:** open compare.png → write down concrete
differences (silhouette, proportions — e.g. "cap is 30% too narrow", "eyes too low", missing parts,
colors, style e.g. low-poly facets vs smooth) → fix the script → re-render → re-compare. Match the
camera angle of the reference (`--angles 35 --elev 10`). Use real modelling (bmesh, modifiers: subdivision,
solidify, bevel; decimate for low-poly look; proportional shapes), not just a few primitives stacked.
Deliver `.blend` + `.glb`, and put the final compare image + score history in the report.
**Budget:** 3–6 render/compare iterations (≈20 min). Fix the biggest difference first (silhouette &
proportions → parts → colors → details). If you hit the budget, stop, deliver the best version and list
the remaining differences honestly — the user can ask for another round. Keep experiments in
`.proof/experiments/`, not in the project root.

Modelling craft (common failures seen in past runs — check each in your renders):
- **Measure proportions first**: from the reference, write down ratios in pixels (total height, cap
  width/height, body width/height, eye size & spacing, head-to-body ratio) and build to those numbers.
  Re-measure on your render the same way. Don't eyeball.
- **Organic volumes**: domes/heads/bodies = UV sphere or subdivided cube, scaled non-uniformly and
  sculpted with bmesh (move vertex rings), then `Decimate` (collapse, ratio 0.2–0.4) or low segment
  counts + flat shading for the low-poly look. A cylinder with a flat top is not a dome.
- **Decals / spots / patterns on a surface**: separate meshes offset 1–2% outward along the normal
  (or a Shrinkwrap modifier with offset), or material/vertex-color painting — never coplanar faces
  (that causes flicker and holes / z-fighting).
- **Faces & small parts**: eyes are ellipsoids with real depth (+ a small white highlight sphere),
  placed ON the surface; arms/feet visible from the main camera angle. Check them in a close-up render.
- **Colors**: set Base Color from the reference's sampled sRGB values converted to linear
  (`c/255` then `((c+0.055)/1.055)**2.4`), roughness ~0.6–0.8 for a matte toy look.
- **Ground & silhouette**: model stands on Z=0, origin at the feet, faces −Y (front view = yaw 0).
