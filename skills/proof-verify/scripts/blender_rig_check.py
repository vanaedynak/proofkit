# blender_rig_check.py — check that moving parts of a model (control surfaces, wheels, doors,
# propellers, turrets, limbs...) will rotate in place instead of flying off when a game animates them.
#
#   blender -b model.blend -P blender_rig_check.py -- [--out .proof/rig] [--import model.glb]
#           [--parts "Aileron_L,Aileron_R,Elevator"] [--angle 30]
#
# For every moving part (names matching common hinge words, or --parts) it:
#   1. checks the pivot (object origin): it must lie on/inside the part, near the hinge edge;
#   2. rotates the part by +-angle about each local axis and measures how far its geometry
#      travels; a part whose closest point jumps far away from the body is "flying off";
#   3. checks it is a separate object (a mirrored pair merged into one object cannot move independently)
#      and parented to the body;
#   4. renders a close-up before/after deflection so you can SEE it.
# Prints RIG OK or RIG PROBLEMS with one line per problem. Exit code 1 on problems.
import bpy, sys, os, math, re
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default

OUT = os.path.abspath(arg('--out', '.proof/rig'))
ANGLE = math.radians(float(arg('--angle', '30')))
os.makedirs(OUT, exist_ok=True)

if arg('--import'):
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(arg('--import')))

HINGE = re.compile(r'aileron|elevon|elevator|rudder|stabil|flap|slat|spoiler|canard|wheel|gear|door|hatch|lid|'
                   r'prop|rotor|blade|turret|barrel|arm|leg|hand|foot|head|jaw|wing_?l|wing_?r|'
                   r'hinge|joint|pivot|lever|pedal|steer', re.I)
parts_arg = arg('--parts')
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.data.vertices]
parts = [o for o in meshes if (o.name in parts_arg.split(',') if parts_arg else HINGE.search(o.name))]

def world_verts(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]

def bbox(vs):
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return lo, hi

all_vs = [v for o in meshes for v in world_verts(o)]
glo, ghi = bbox(all_vs)
model_size = (ghi - glo).length
problems, lines = [], []

for o in parts:
    vs = world_verts(o)
    lo, hi = bbox(vs)
    size = max((hi - lo).length, 1e-6)
    origin = o.matrix_world.translation.copy()
    # distance from pivot to the part's own bounding box (0 = pivot inside the part)
    d_out = (Vector((max(lo.x - origin.x, 0, origin.x - hi.x), max(lo.y - origin.y, 0, origin.y - hi.y),
                     max(lo.z - origin.z, 0, origin.z - hi.z)))).length
    # how far the geometry travels when the part is deflected about its pivot
    worst = 0.0
    for axis in 'XYZ':
        R = Matrix.Translation(origin) @ Matrix.Rotation(ANGLE, 4, axis) @ Matrix.Translation(-origin)
        worst = max(worst, max(((R @ v) - v).length for v in vs[:: max(1, len(vs) // 400)]))
    # a part rotating about its hinge moves at most ~ its own size * angle; far more = it flies off
    allowed = size * ANGLE * 1.3 + 0.01 * model_size
    # islands: a mirrored left+right pair merged into one object
    me = o.data
    import bmesh
    bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    seen, islands = set(), 0
    for v in bm.verts:
        if v.index in seen: continue
        islands += 1; stack = [v]
        while stack:
            x = stack.pop()
            if x.index in seen: continue
            seen.add(x.index); stack.extend(e.other_vert(x) for e in x.link_edges)
    bm.free()
    symmetric_pair = islands >= 2 and lo.x < -0.02 * model_size and hi.x > 0.02 * model_size and abs(origin.x) < 0.02 * model_size and size > 0.3 * model_size
    line = f'{o.name}: pivot {tuple(round(c, 2) for c in origin)}, pivot-to-part {d_out:.2f}, max travel at {math.degrees(ANGLE):.0f}deg {worst:.2f} (ok <= {allowed:.2f}), islands {islands}, parent {o.parent.name if o.parent else None}'
    lines.append(line)
    if d_out > 0.05 * size + 0.005 * model_size or worst > allowed:
        problems.append(f'PIVOT: {o.name} pivot is {d_out:.2f} away from the part — rotating it moves it {worst:.2f} units, it will fly off. '
                        f'Set its origin to the hinge line (e.g. bpy.context.scene.cursor.location = hinge; bpy.ops.object.origin_set(type="ORIGIN_CURSOR")) before export.')
    if symmetric_pair:
        problems.append(f'MERGED: {o.name} contains left and right pieces in one object ({islands} islands) — they can only move together. Split into _L/_R objects with their own hinge pivots (all-moving stabilators that move together are fine; ailerons are not).')

# close-up render of each part: neutral vs deflected
def render_part(o, tag):
    import importlib
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 640, 480
    vs = world_verts(o); lo, hi = bbox(vs); c = (lo + hi) / 2
    r = max((hi - lo).length, model_size * 0.25)
    cam = bpy.data.objects.get('_rigcam') or bpy.data.objects.new('_rigcam', bpy.data.cameras.new('_rigcam'))
    if cam.name not in scene.collection.objects: scene.collection.objects.link(cam)
    d = Vector((0.9, -1.4, 0.8)).normalized() * r * 1.8
    cam.location = c + d
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    if not any(ob.type == 'LIGHT' for ob in scene.objects):
        L = bpy.data.objects.new('_riglight', bpy.data.lights.new('_riglight', 'SUN')); L.data.energy = 4
        L.rotation_euler = (0.8, 0.2, 0.5); scene.collection.objects.link(L)
    scene.render.filepath = os.path.join(OUT, f'{re.sub(r"[^A-Za-z0-9_]+", "_", o.name)}_{tag}.png')
    bpy.ops.render.render(write_still=True)

for o in parts[:12]:
    saved = o.matrix_world.copy()
    try:
        render_part(o, '0_neutral')
        origin = saved.translation.copy()
        o.matrix_world = Matrix.Translation(origin) @ Matrix.Rotation(ANGLE, 4, 'X') @ Matrix.Translation(-origin) @ saved
        render_part(o, '1_deflected')
    except Exception as e:
        lines.append(f'render failed for {o.name}: {e}')
    o.matrix_world = saved

print('RIG CHECK parts:', len(parts), '(of', len(meshes), 'meshes)')
for l in lines: print('  ' + l)
if not parts:
    print('  note: no moving parts found by name; pass --parts "A,B" to check specific objects')
if problems:
    print('RIG PROBLEMS:')
    for p in problems: print('  - ' + p)
else:
    print('RIG OK')
print('renders:', OUT)
sys.exit(1 if problems else 0)
