'use strict';
const path=require('path');
const os=require('os');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const blender=process.env.REALM_BLENDER_EXE || path.join(os.homedir(),'.codex/tool-cache/blender/blender-4.5.12-windows-x64/blender.exe');
for(const script of ['check_suit_surface_metrics.py','check_articulated_simplifier.py',
  'check_world_skin_binding.py','check_suit_leg_ownership.py','check_suit_joint_spans.py','check_suit_upperarm_slits.py','check_suit_enclosure.py','check_suit_glove_seams.py','check_layered_suit_fit.py']) {
  const result=spawnSync(blender,['--background','--factory-startup','--python-exit-code','1','--python','tools/blender/'+script],{cwd:root,stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0) { process.exitCode=result.status??1; break; }
}
