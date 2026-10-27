import type { RoughMotion, RoughPoint, RoughProfileSegment } from './linuxcncRoughing';
import type { MacroSubroutineDefinition } from './linuxcncMacro';

/** Resolve a numeric G90 XZ profile for a LinuxCNC G7x cycle. Unsupported expressions stop before geometry is generated. */
export function resolveLinuxCncProfile(routine: MacroSubroutineDefinition, start: RoughPoint): {ok:true; profile:RoughProfileSegment[]} | {ok:false;sourceLine:number;message:string} {
  let position={...start}; let motion:RoughMotion | null=null;
  const profile:RoughProfileSegment[]=[];
  for(const row of routine.body){
    const code=row.sourceText.replace(/\([^()]*\)/g,'').replace(/;.*/, '');
    let rest=code; const words=new Map<string,number>();
    while(rest.trim()){
      rest=rest.trimStart();const token=/^([a-z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/i.exec(rest);
      if(!token)return {ok:false,sourceLine:row.sourceLine,message:'Only numeric XZ profile words are supported'};
      const letter=token[1].toUpperCase(),value=Number(token[2]);
      if(!Number.isFinite(value)||words.has(letter))return {ok:false,sourceLine:row.sourceLine,message:'Duplicate or non-finite profile word'};
      words.set(letter,value);rest=rest.slice(token[0].length);
    }
    if(!words.size)continue;
    if([...words.keys()].some(key=>!['N','G','X','Z','I','K','A','C'].includes(key)))return {ok:false,sourceLine:row.sourceLine,message:'Unsupported G71 profile word'};
    const g=words.get('G');
    if(g!==undefined){if(![0,1,2,3].includes(g))return {ok:false,sourceLine:row.sourceLine,message:'Unsupported G71 profile motion'};motion=(`G0${g}` as RoughMotion);}
    if(!motion)return {ok:false,sourceLine:row.sourceLine,message:'G71 profile motion mode is unknown'};
    const end={x:words.get('X') ?? position.x,z:words.get('Z') ?? position.z};
    if(words.has('A')&&words.has('C'))return {ok:false,sourceLine:row.sourceLine,message:'A and C cannot both describe one corner'};
    const a=words.get('A'),c=words.get('C');
    if((a!==undefined&&a<0)||(c!==undefined&&c<0))return {ok:false,sourceLine:row.sourceLine,message:'Corner radius must not be negative'};
    const arc=motion==='G02'||motion==='G03';
    if(arc&&!words.has('I')&&!words.has('K'))return {ok:false,sourceLine:row.sourceLine,message:'G71 arc requires an I or K center offset'};
    if(!arc&&(words.has('I')||words.has('K')))return {ok:false,sourceLine:row.sourceLine,message:'Center offsets require an arc'};
    // LinuxCNC's G7x profile builder creates neither a segment nor a corner when the endpoint is unchanged.
    if(end.x===position.x && end.z===position.z)continue;
    profile.push({motion,end,...(arc?{center:{x:position.x+(words.get('I') ?? 0),z:position.z+(words.get('K') ?? 0)}}:{}),...(a!==undefined?{corner:{kind:'fillet' as const,amount:a}}:c!==undefined?{corner:{kind:'chamfer' as const,amount:c}}:{}),sourceLine:row.sourceLine,rawCode:row.sourceText});
    position=end;
  }
  return {ok:true,profile};
}
