"""Run an isolated candidate build while diagnosing any exporter mesh repairs."""
import sys,runpy
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).parent))
import build_free_armor_replacements as rig
import build_suit_joint_liner as textile

original_export=rig.export_review
def audit(stage,equipment):
    for obj in equipment:
        test=obj.data.copy()
        before=(len(test.vertices),len(test.edges),len(test.polygons))
        changed=test.validate(verbose=True)
        print('STAGE_VALIDATION',stage,obj.name,'changed',changed,before,
            (len(test.vertices),len(test.edges),len(test.polygons)),flush=True)
        bpy.data.meshes.remove(test)
        if changed:
            seen={}
            for face in obj.data.polygons:
                key=tuple(sorted(face.vertices))
                if key in seen:
                    print('DUPLICATE_SOURCE_FACE',seen[key],face.index,
                        [list(obj.matrix_world@obj.data.vertices[i].co) for i in key],flush=True)
                seen[key]=face.index
            if '--save-invalid-mesh' in sys.argv:
                destination=Path(__file__).resolve().parents[2]/'unity-client/Logs/suit-invalid-stage.blend'
                bpy.ops.wm.save_as_mainfile(filepath=str(destination))
            raise RuntimeError('First invalid mesh stage: '+stage+' / '+obj.name)

def inspect(output,armature,equipment):
    audit('donor export',equipment)
    original_export(output,armature,equipment)
rig.export_review=inspect
if '--candidate' not in sys.argv:raise RuntimeError('Validation diagnosis is candidate-only')
def wrap_geometry(name):
    operation=getattr(textile,name)
    def checked(obj,*args,**kwargs):
        obj.data.calc_loop_triangles();seen={}
        for triangle in obj.data.loop_triangles:
            key=tuple(sorted(triangle.vertices))
            if key in seen:
                other=seen[key]
                print('DUPLICATE_INPUT_TRIANGLE',name,obj.name,other.polygon_index,
                    triangle.polygon_index,list(other.vertices),list(triangle.vertices),
                    other.material_index,triangle.material_index,flush=True)
            seen[key]=triangle
        audit(name+' input',[obj])
        result=operation(obj,*args,**kwargs)
        audit(name+' output',[obj])
        return result
    setattr(textile,name,checked)
for name in ('freeze_surface_triangles','simplify_endpoints'):wrap_geometry(name)
namespace=runpy.run_path(str(Path(__file__).with_name('build_layered_suit_models.py')),run_name='suit_validation')
globals_=namespace['main'].__globals__
def wrap(name):
    operation=globals_[name]
    def checked(equipment,*args,**kwargs):
        result=operation(equipment,*args,**kwargs)
        audit(name,equipment)
        return result
    globals_[name]=checked
for name in ('refit_lower_suit','refit_gloves','fit_retained','add_joint_liner'):wrap(name)
namespace['main']()
