'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');

function writeAtomicJson(file,value,pretty=false) {
  const content=JSON.stringify(value,null,pretty?2:undefined)+'\n';
  const target=path.resolve(file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const temporary=target+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';
  let descriptor;
  try {
    descriptor=fs.openSync(temporary,'wx');
    fs.writeFileSync(descriptor,content);fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);descriptor=undefined;
    fs.renameSync(temporary,target);
  } finally {
    if(descriptor!==undefined)fs.closeSync(descriptor);
    if(fs.existsSync(temporary))fs.unlinkSync(temporary);
  }
}
module.exports={writeAtomicJson};
