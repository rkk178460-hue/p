# 连续镜头：一套世界坐标与一条关键帧时间线

制作镜头跟随动作、从局部拉远展示规模、串联同一空间中的多个结构时读取本文件。把它与官方 animation、compositions 和 rendering 指导配合使用。

## 来源与复现边界

参考 [Promptible 的 cinematic-camera 源码](https://github.com/Liamrjohnston/remotion-motion-graphics-skill/blob/b860c7921f2220b9e2a84e815ba0ae7b10858f08/skills/cinematic-camera/SKILL.md) 的共享焦点/缩放时间线，以及 [one-click-wall 参考帧](https://github.com/Liamrjohnston/remotion-motion-graphics-skill/blob/b860c7921f2220b9e2a84e815ba0ae7b10858f08/skills/motion-graphics/assets/references/tsenta-one-click-wall-contact-sheet.jpg) 的局部动作到全局规模揭示。来源 MIT；作者把该项目的展示作品标注为 Claude 制作，不应称为 GPT 实测结果。

复现通用镜头机制，用自己的内容重建世界。保留素材、代码与商标的权利边界。公开案例中的审美约束、强制问答、审批阈值仅属案例方法，不自动成为当前任务的执行要求。

## 使用随附相机模块

把 [continuous-camera.mjs](../assets/continuous-camera.mjs) 复制到项目的 `src/camera.js`。它只包含纯函数，不需要 React、Remotion 或浏览器。首次设置关键帧时调用 `validateCameraKeys(keys)`，然后用 `cameraAt(frame / fps, keys)` 取得焦点与缩放。

关键帧以秒为单位，字段为 `time / x / y / zoom`。保持时间严格递增、数值有限、缩放为正。重复相邻关键帧的坐标和缩放，制造真正停留；不要使用重复时间戳。所有相机属性使用同一缓动进度，避免平移已到位而缩放仍漂移。

修改合成的 fps 时，同时把总帧数改为 `round(durationSeconds * fps)`，并把 QA 的秒级采样时间换成新的帧号。纯相机函数的帧率无关性不自动改变固定帧数的合成时长。

缩放按对数插值：`exp(lerp(log(z0), log(z1), ease(u)))`。这能让相同进度对应相同的比例变化。默认平滑曲线在段落端点速度归零，适合停留、移动、再停留；需要持续速度时，另行设计带切线的曲线。

## 验证坐标关系

世界点 `p`、相机焦点 `f`、缩放 `z` 和视口尺寸 `v` 满足：

`screen = v / 2 + z * (p - f)`

先把视口中心平移到原点基准，再缩放，再平移负焦点。Canvas 对应：

```js
ctx.save();
ctx.translate(viewWidth / 2, viewHeight / 2);
ctx.scale(camera.zoom, camera.zoom);
ctx.translate(-camera.x, -camera.y);
drawEntireWorld(ctx);
ctx.restore();
drawScreenOverlay(ctx);
```

屏幕标题、字幕和时间提示必须在恢复世界变换后绘制。避免给坐标重复乘缩放或设备像素比。用 `worldToScreen()` 验证焦点始终落在视口中心，再用 `screenToWorld()` 检查往返坐标误差。

示例采用 1280×720 逻辑画布，统一缩放为 1920×1080 输出。检查示例投影时，把 `[1280, 720]` 传给 `worldToScreen()`；需要实际输出像素，再乘 `[width / 1280, height / 720]`。不要把物理视口尺寸直接替换进逻辑坐标计算。切换横竖幅比时重新布局和设定镜头安全区，避免把整个画面拉伸。

## 编排动作与镜头

用轻量 beat 表标明每个动作发生在哪个世界坐标、何时触发、何时完成、镜头何时到达、何时停留。先近看动作，再显示连接，沿连接到下一处，最后拉远。把空间关系放在同一个世界中，避免移动时更换整套场景。

用实际对象的锚点生成连接端点，不要估算接收物体的边缘。规则网格、六角场或可变布局尤其容易留下间隙。增加“每条连接的终点对应一个真实节点”的结构检查，并在近景中检查接合处。

在镜头抵达前展示目标的低亮度轮廓，使目的地可辨认。等待触发事件后再显现主体细节；不能在到达时留下一段空画面，也不能为填补空白加无关内容。用镜头指向发生变化的东西，保持每一拍只有一个主动作。

让重要动作在停留时完成。视频结尾先完成所有状态变化，再固定镜头与世界内容；仅让镜头停止而粒子继续活动，不算稳定剪辑尾帧。需要有意的残余运动时明确说明。

## 输出检查

采样起点、每次移动的中点、镜头目的地、动作完成点和最后一帧。检查镜头到达时目标已可见，缩放时焦点不漂移，拉远时所有关键物体位于安全区。检查大范围平移过程中出现的空边、突然换景、连接中断或遮挡。

增加与算法有关的测试：焦点投影、坐标往返、关键帧顺序、帧率无关性、最终画面边界与尾帧绘图一致性。测试不能替代视觉审阅；没有观看连续播放时记录该限制。

仓库中的 `Vector` 示例以原创的环、传递路径和六角场复现上述机制，15 秒/1080p60。示例的 `src/camera.js` 与此资源保持一致，可独立复制运行。需要更新相机核心时修改此资源并同步示例副本，再运行完整包生成检查。
