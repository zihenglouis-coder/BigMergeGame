from pathlib import Path
import numpy as np,json,base64
from PIL import Image
from scipy.ndimage import label,binary_fill_holes
root=Path(__file__).resolve().parent.parent
def rdp(p,eps):
 if len(p)<=2:return p
 a,b=p[0],p[-1];ab=b-a
 ds=np.linalg.norm(p-a,axis=1) if not np.any(ab) else np.abs(ab[0]*(a[1]-p[:,1])-(a[0]-p[:,0])*ab[1])/np.linalg.norm(ab)
 k=int(ds.argmax())
 return np.vstack((rdp(p[:k+1],eps)[:-1],rdp(p[k:],eps))) if ds[k]>eps else p[[0,-1]]
def contour(mask):
 edges={}
 for y,x in zip(*np.where(mask)):
  if y==0 or not mask[y-1,x]: edges.setdefault((x,y),[]).append((x+1,y))
  if x==mask.shape[1]-1 or not mask[y,x+1]:edges.setdefault((x+1,y),[]).append((x+1,y+1))
  if y==mask.shape[0]-1 or not mask[y+1,x]:edges.setdefault((x+1,y+1),[]).append((x,y+1))
  if x==0 or not mask[y,x-1]:edges.setdefault((x,y+1),[]).append((x,y))
 loops=[]
 while edges:
  start=next(iter(edges)); point=start;loop=[]
  while True:
   loop.append(point);nxt=edges[point].pop()
   if not edges[point]: del edges[point]
   point=nxt
   if point==start:break
  if len(loop)>8:loops.append(loop)
 return max(loops,key=len)
items=[]
for i in range(1,9):
 im=Image.open(root/f'assets/ball{i}.png').convert('RGBA');a=np.array(im)
 rgb=a[:,:,:3].astype(int);white=(rgb.min(2)>240)&((rgb.max(2)-rgb.min(2))<18)
 labs,n=label(white);ids=np.unique(np.concatenate([labs[0],labs[-1],labs[:,0],labs[:,-1]]));ids=ids[ids!=0]
 mask=~np.isin(labs,ids)&(a[:,:,3]>=128)
 ys,xs=np.where(mask);box=[int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]
 # Geometry analysis only: source images stay byte-for-byte intact.
 cropped=mask[box[1]:box[3],box[0]:box[2]];h,w=cropped.shape
 gw=max(2,round(w/max(w,h)*256));gh=max(2,round(h/max(w,h)*256))
 grid=cropped[np.minimum(h-1,((np.arange(gh)+.5)*h/gh).astype(int))[:,None],np.minimum(w-1,((np.arange(gw)+.5)*w/gw).astype(int))[None,:]]
 grid=binary_fill_holes(grid);components,n=label(grid)
 polys=[]
 for k in range(1,n+1):
  m=components==k
  if m.sum()<6:continue
  p=np.array(contour(m),dtype=float);j=int(np.sum((p-p[0])**2,axis=1).argmax())
  simp=np.vstack((rdp(p[:j+1],1.5)[:-1],rdp(np.vstack((p[j:],p[:1])),1.5)[:-1]))
  polys.append([[round(float(x/gw-.5),7),round(float(y/gh-.5),7)] for x,y in simp])
 items.append({'box':box,'polygons':polys})
 print(i,'box',box,'contour vertices',[len(p) for p in polys])
(root/'assets/collision-data.js').write_text('// Collision outlines measured from the same border-connected white mask used by sprites.js.\nwindow.COLLISION_DATA = '+json.dumps(items,separators=(',',':'))+';\n')

sources=["data:image/png;base64,"+base64.b64encode((root/f"assets/ball{i}.png").read_bytes()).decode() for i in range(1,9)]
(root/"assets/stickers.js").write_text("// Embedded original images for file:// compatibility.\nwindow.STICKER_SOURCES = "+json.dumps(sources)+";\n")
print("Updated embedded images and collision outlines.")
