BigMergeGame — 人物轮廓碰撞版

运行：解压整个文件夹，双击 index.html。游戏依赖已放入 vendor，运行不需要联网。
操作：移动鼠标瞄准，点击或触摸投放；同等级人物接触后合成；按 C 显示/隐藏蓝色碰撞轮廓。

本次修复：
1. 加载图片时清除与边缘相连的近白色背景，保留人物内部白色文字、眼睛和衣服。
2. 按人物可见外轮廓构建凹多边形复合碰撞体，替代原来的圆形。
3. 保持图片比例，去掉预览的圆形裁剪及圆形底色，NEXT 同样使用透明贴纸。
4. 校正图片中心与物理重心偏移，让旋转中的人物和碰撞体保持对齐。
5. 复合碰撞事件归到所属人物，并在物理更新后合成，避免重复计分。
6. 危险线判断使用实际碰撞边界；图片准备完成后才允许投放。

说明：碰撞轮廓为适度简化的外轮廓，极小的细节和内部孔洞不单独建模。
原始 ball1.png 至 ball8.png 保留不变，透明效果由 sprites.js 的绘制管线产生。

以后换图片：
替换 assets/ball1.png 至 ball8.png 后，需要更新嵌入图片和对应轮廓：
  pip install Pillow numpy scipy
  python tools/build_stickers.py
随后重新打开 index.html。只替换 PNG 而不更新数据不会改变画面。

第三方代码：vendor/matter.min.js（Matter.js 0.20.0，MIT），
vendor/decomp.min.js（poly-decomp 0.3.0，MIT）。
