# 路径描边、几何变形与三维投影

制作 SVG 描边、轮廓之间的连续变形、投影到二维画面的空间曲线时读取本文件。以官方 markup 和 rendering 模块核对具体 Remotion API。

## 来源与边界

参考 Motion Canvas 的 [asset-code intro](https://github.com/motion-canvas/examples/blob/8ffefed144368d33de4b0e451894c718eb95d574/examples/asset-code/src/scenes/intro.tsx) 中的显式 morph/shape 参数，以及 [Tetrahedron.ts](https://github.com/motion-canvas/examples/blob/8ffefed144368d33de4b0e451894c718eb95d574/examples/asset-code/src/nodes/Tetrahedron.ts) 中的顶点变换、透视除法和前后线条区分。代码为 MIT，仓库已保存许可。这里重写通用机制，不复制原片、背景 shader、文字或媒体素材。

## 先确定顶点对应关系

把 [path-geometry.mjs](../assets/path-geometry.mjs) 复制到项目。使用有限的三维顶点 `[x,y,z]` 描述轮廓；平面轮廓的 z 为 0。用 `resampleClosed(points, count)` 沿完整闭合轮廓的弧长重采样，包含最后一条边，但不重复起点。

所有变形目标使用相同采样数。再统一轮廓方向与起始锚点，避免只因索引错位而突然扭转。平面目标可用 `signedAreaXY()` 核对方向，用一个明确位置作为第 0 个顶点。复杂轮廓必要时单独匹配语义锚点；等数量本身不能保证良好的形状对应。

用 `mixPaths(a,b,progress)` 插值对应顶点。保持阶段边界与前一阶段的终态一致。几何单测应检查采样数量、闭合边、方向、锚点、有限坐标、阶段连续性与安全区。允许变形过程出现自交时明确这是轮廓动画，不要宣称它是保持拓扑或体积的实体模拟。

## 用帧控制 SVG 描边

使用 `pathLength={1}`、`strokeDasharray="1 1"` 和 `strokeDashoffset={1-progress}`，其中 progress 来自当前帧。不要用 CSS 自启动动画；也不必每帧调用 DOM 的 `getTotalLength()`。

绘制一层低亮度完整轮廓，再显示正在增长的主描边，确保一开始目标可辨认。采用明确线帽与拐角。需要拖尾时，用多个过去时刻的几何采样，保持确定性；不要让过去帧的像素积累成不可跳帧的状态。

## 投影与深度

先对三维顶点施加正交旋转，再投影。随附 `projectPoint()` 对相机沿 z 轴的简化情况计算：

`screenXY = focal * worldXY / (cameraDistance + worldZ)`

当分母不大于 near 时返回 null。调用者应裁切穿过近裁面的线段，或像示例一样选择保证全部顶点在安全范围内的相机；不能把 null 或非有限坐标写入 SVG。

区分真实的三维坐标变换与视觉近似。FORM 按每条线段平均深度从远到近排序，用背景色擦除交叉处的远线，再绘制近线。擦除段缩短并采用 butt 线帽，避免把相邻线段的连接点切出孔洞。这是细线条的近似遮挡，不能替代精确交点深度、曲面隐藏面判断、Z-buffer 或实体光照。

## 减速、暂停与可携带性

不要在尾帧突然冻结仍在匀速旋转的对象。先用速度逐渐归零的时间映射减速，再固定全部世界状态。检查最后停留段的输出几何或 PNG 是否一致。

使用本地字体并等待加载。公共字体 hook 可供 Canvas 和 SVG 共用；改变 hook 后抽查原有示例，防止新视频可运行而旧视频缺字。把可携带示例依赖的几何资源复制进自身目录，并在完整包生成时检查它与 skill 资源一致。

先通过类型检查和几何单测，再做实际渲染。纯 JavaScript 几何测试通过不能证明 TSX 可以编译。最后抽查描边中途、变形中点、阶段边界、投影交叉点、减速与收尾，并验证编码格式和全片解码。播放与实机检查不可用时记录限制。
