### 3D models that will be ANIMATED or used in a game
Every part that moves (ailerons, elevators, rudder, flaps, wheels, doors, propellers, turrets, limbs)
must be: a **separate object** (left and right separately), **parented** to the body, with its
**origin exactly on the hinge line/axle** (`scene.cursor.location = hinge; bpy.ops.object.origin_set(type='ORIGIN_CURSOR')`),
and a clear name (`Aileron_L`, `Elevator_R`, `Wheel_FL`). The rotation axis should be a local axis
along the hinge. Then run:
```bash
blender -b model.blend -P <skill>/scripts/blender_rig_check.py -- --out .proof/rig [--parts "Aileron_L,Aileron_R"]
```
It deflects each moving part and prints `RIG OK` or `PIVOT:`/`MERGED:` problems plus before/after
close-up renders — open them. In code, rotate only those child objects around their own local axis;
never rotate a part whose origin is at the model center. Verify in the game with the close-up filmstrip.
