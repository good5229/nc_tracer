import * as THREE from 'three';

/** Find edge-connected, coplanar triangles in the displayed grid mesh. */
export class FacePatchFinder {
 private positions:THREE.BufferAttribute;
 private edges=new Map<string,number[]>();
 private triangles:string[][]=[];
 constructor(geometry:THREE.BufferGeometry){
  this.positions=geometry.getAttribute('position') as THREE.BufferAttribute;
  const key=(i:number)=>`${this.positions.getX(i).toFixed(6)},${this.positions.getY(i).toFixed(6)},${this.positions.getZ(i).toFixed(6)}`;
  for(let face=0;face<this.positions.count/3;face++){
   const points=[key(face*3),key(face*3+1),key(face*3+2)];
   const keys=[[0,1],[1,2],[2,0]].map(([a,b])=>points[a]<points[b]?`${points[a]}|${points[b]}`:`${points[b]}|${points[a]}`);
   this.triangles.push(keys);
   for(const edge of keys){const list=this.edges.get(edge);if(list)list.push(face);else this.edges.set(edge,[face]);}
  }
 }
 find(start:number):{bounds:THREE.Box3;outline:Float32Array}|null{
  if(!this.triangles[start])return null;
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),normal=new THREE.Vector3(),cross=new THREE.Vector3();
  const read=(face:number)=>{a.fromBufferAttribute(this.positions,face*3);b.fromBufferAttribute(this.positions,face*3+1);c.fromBufferAttribute(this.positions,face*3+2);};
  read(start);normal.crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
  if(normal.lengthSq()===0)return null;
  const plane=normal.dot(a),seen=new Set([start]),queue=[start],bounds=new THREE.Box3();
  for(let head=0;head<queue.length;head++){
   const face=queue[head];read(face);bounds.expandByPoint(a);bounds.expandByPoint(b);bounds.expandByPoint(c);
   for(const edge of this.triangles[face])for(const neighbor of this.edges.get(edge)??[]){
    if(seen.has(neighbor))continue;
    read(neighbor);cross.crossVectors(b.clone().sub(a),c.clone().sub(a)).normalize();
    if(Math.abs(cross.dot(normal))>0.99999&&Math.abs(normal.dot(a)-plane)<0.000001){seen.add(neighbor);queue.push(neighbor);}
   }
  }
  const outline:number[]=[];
  for(const face of queue){
   for(let edge=0;edge<3;edge++){
    const key=this.triangles[face][edge],shared=(this.edges.get(key)??[]).filter(other=>seen.has(other)).length;
    if(shared!==1)continue;
    const i=face*3+edge,j=face*3+(edge+1)%3;
    outline.push(this.positions.getX(i),this.positions.getY(i),this.positions.getZ(i),this.positions.getX(j),this.positions.getY(j),this.positions.getZ(j));
   }
  }
  return {bounds,outline:new Float32Array(outline)};
 }
}

/** Axis ranges for the selected patch; a face's constant axis has no length. */
export function faceAxisDimensions(size:{x:number;y:number;z:number}):{axis:'X'|'Y'|'Z';length:number}[]{
 return ([{axis:'X',length:size.x},{axis:'Y',length:size.y},{axis:'Z',length:size.z}] as const)
  .filter(dimension=>dimension.length>0);
}
