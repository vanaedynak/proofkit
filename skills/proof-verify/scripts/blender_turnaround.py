"""Render a model from several angles so you can SEE it (and compare it to a reference).

Usage (headless, from any folder):
  blender -b model.blend -P blender_turnaround.py -- --out .proof/render
  blender -b -P blender_turnaround.py -- --import model.glb --out .proof/render
Options after "--":
  --out DIR          output folder (default .proof/render)
  --import FILE      import .glb/.gltf/.fbx/.obj instead of using the opened .blend
  --size N           image side in px (default 768)
  --angles LIST      comma list of yaw degrees, 0 = front (-Y), default 0,35,90,180
  --elev DEG         camera elevation (default 12)
  --bg R,G,B         background gray (default 0.85,0.85,0.85 — like most concept references)
  --keep-lights      use the scene's own lights/world instead of the neutral studio setup

Writes view_<yaw>.png per angle + contact_sheet.png (all views in one image) and prints a summary:
object count, total vertices/faces, bounding-box size, materials. Does not modify the .blend file.
"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {"out": ".proof/render", "size": "768", "angles": "0,35,90,180", "elev": "12", "bg": "0.85,0.85,0.85"}
flags = set()
i = 0
while i < len(argv):
    k = argv[i].lstrip("-")
    if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
        opt[k] = argv[i + 1]; i += 2
    else:
        flags.add(k); i += 1

out = os.path.abspath(opt["out"])
os.makedirs(out, exist_ok=True)
scene = bpy.context.scene

if "import" in opt:
    f = opt["import"]; ext = os.path.splitext(f)[1].lower()
    if ext in (".glb", ".gltf"): bpy.ops.import_scene.gltf(filepath=f)
    elif ext == ".fbx": bpy.ops.import_scene.fbx(filepath=f)
    elif ext == ".obj": bpy.ops.wm.obj_import(filepath=f)
    else: raise SystemExit(f"unsupported import format {ext}")

meshes = [o for o in scene.objects if o.type == "MESH" and o.visible_get()]
if not meshes:
    raise SystemExit("PROBLEM: no visible mesh objects in the scene")

# bounding box of everything visible (world space, evaluated with modifiers)
dg = bpy.context.evaluated_depsgraph_get()
mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
verts = faces = 0
mats = set()
for o in meshes:
    ev = o.evaluated_get(dg); me = ev.to_mesh()
    verts += len(me.vertices); faces += len(me.polygons)
    for v in me.vertices:
        w = o.matrix_world @ v.co
        mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    for s in o.material_slots:
        if s.material: mats.add(s.material.name)
    ev.to_mesh_clear()
center = (mn + mx) / 2
size = mx - mn
radius = max(size.length / 2, 1e-3)

# neutral studio: remove nothing from the file, just hide existing lights and add ours
if "keep-lights" not in flags:
    for o in scene.objects:
        if o.type == "LIGHT": o.hide_render = True
    def light(name, energy, loc, size_):
        d = bpy.data.lights.new(name, "AREA"); d.energy = energy * radius * radius; d.size = size_ * radius
        ob = bpy.data.objects.new(name, d); scene.collection.objects.link(ob)
        ob.location = center + Vector(loc) * radius
        ob.rotation_euler = (center - ob.location).to_track_quat("-Z", "Y").to_euler()
    light("pk_key", 220, (-2.5, -3, 3.5), 2.5)
    light("pk_fill", 90, (3, -2, 1.5), 3)
    light("pk_rim", 140, (0, 3.5, 3), 2)
    world = bpy.data.worlds.new("pk_world"); world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    r, g, b = map(float, opt["bg"].split(","))
    bg.inputs[0].default_value = (r, g, b, 1); bg.inputs[1].default_value = 1.0
    scene.world = world
    scene.view_settings.view_transform = "Standard"

cam_data = bpy.data.cameras.new("pk_cam"); cam_data.lens = 50
cam = bpy.data.objects.new("pk_cam", cam_data); scene.collection.objects.link(cam)
scene.camera = cam
try:
    scene.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = scene.render.resolution_y = int(opt["size"])
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"

fov = cam_data.angle
dist = radius / math.sin(fov / 2) * 0.92
elev = math.radians(float(opt["elev"]))
paths = []
for yaw_deg in [float(a) for a in opt["angles"].split(",")]:
    yaw = math.radians(yaw_deg)
    # yaw 0 = camera in front of the model looking along +Y (Blender's "front" view)
    direction = Vector((math.sin(yaw) * math.cos(elev), -math.cos(yaw) * math.cos(elev), math.sin(elev)))
    cam.location = center + direction * dist
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    p = os.path.join(out, f"view_{int(yaw_deg):03d}.png")
    scene.render.filepath = p
    bpy.ops.render.render(write_still=True)
    paths.append(p)

# contact sheet: all views side by side
imgs = [bpy.data.images.load(p) for p in paths]
w = imgs[0].size[0]; h = imgs[0].size[1]
sheet = bpy.data.images.new("pk_sheet", width=w * len(imgs), height=h)
px = [0.0] * (w * len(imgs) * h * 4)
for n, im in enumerate(imgs):
    src = list(im.pixels)
    for y in range(h):
        row = src[y * w * 4:(y + 1) * w * 4]
        start = (y * w * len(imgs) + n * w) * 4
        px[start:start + w * 4] = row
sheet.pixels = px
sheet.filepath_raw = os.path.join(out, "contact_sheet.png"); sheet.file_format = "PNG"; sheet.save()

print("TURNAROUND OK")
print(f"  objects={len(meshes)} vertices={verts} faces={faces} materials={sorted(mats)}")
print(f"  bbox size (m) = {size.x:.3f} x {size.y:.3f} x {size.z:.3f}  (X width, Y depth, Z height)")
for p in paths: print("  " + p)
print("  " + os.path.join(out, "contact_sheet.png"))
if not mats: print("  WARNING: no materials — everything renders default gray")
