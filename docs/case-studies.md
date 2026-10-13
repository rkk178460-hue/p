# 开源动效案例与复现范围

核对日期：2026-10-13。先读源码，再提取机制；“精彩”是选题判断，不是排行榜。没有声称观看了所有原片，也没有把不同模型的作品归为 GPT 实测结果。

## 已做成可运行小样

来源：[motion-canvas/examples](https://github.com/motion-canvas/examples)，固定提交 `8ffefed144368d33de4b0e451894c718eb95d574`，MIT，许可保存在 `licenses/motion-canvas-MIT.txt`。

| 案例 | 已检查源码 | 复现内容 | 本仓库入口 |
| --- | --- | --- | --- |
| [Smooth Parallax](https://youtu.be/c_3TLN2gHow) | [Parallax.tsx](https://github.com/motion-canvas/examples/blob/8ffefed144368d33de4b0e451894c718eb95d574/examples/smooth-parallax/src/components/Parallax.tsx) | 四层速度比 0 / 0.5 / 1 / 3；相机位移映射；循环补边 | `ParallaxStudy`，6 秒 |
| Motion Canvas Logo | [logo.tsx](https://github.com/motion-canvas/examples/blob/8ffefed144368d33de4b0e451894c718eb95d574/examples/logo/src/scenes/logo.tsx) | 局部轨迹裁切；独立速度；并行动画 | `MaskTrailsStudy`，4 秒 |

这两个小样复现动画机制，重新编写 Canvas 代码和几何素材；没有搬运原片、音乐、标志或像素图。视差源实现还支持像素吸附，本次仅实现连续位移。标志源使用合成掩码，本次以局部 `clip()` 实现等价的矩形裁切；中心图案改成原创方框。

## 第二轮：连续镜头与规模揭示

来源：[Liamrjohnston/remotion-motion-graphics-skill](https://github.com/Liamrjohnston/remotion-motion-graphics-skill)，固定提交 `b860c7921f2220b9e2a84e815ba0ae7b10858f08`。核对了 [cinematic-camera 的相机代码](https://github.com/Liamrjohnston/remotion-motion-graphics-skill/blob/b860c7921f2220b9e2a84e815ba0ae7b10858f08/skills/cinematic-camera/SKILL.md)、[案例机制索引](https://github.com/Liamrjohnston/remotion-motion-graphics-skill/blob/b860c7921f2220b9e2a84e815ba0ae7b10858f08/skills/motion-graphics/references/approved-references.md) 和 [one-click-wall 参考帧](https://github.com/Liamrjohnston/remotion-motion-graphics-skill/blob/b860c7921f2220b9e2a84e815ba0ae7b10858f08/skills/motion-graphics/assets/references/tsenta-one-click-wall-contact-sheet.jpg)。代码与指南为 MIT，保留 `licenses/promptible-MIT.txt`；参考帧用于检查，没有复制品牌界面到本项目。

`Vector` 复现共享世界、镜头停留/移动/停留，以及从局部动作拉远到完整结构的机制。新增的相机模块由本项目重写，采用共享缓动进度与对数缩放，提供双向坐标投影。影片使用原创环形结构、传递路径和六角几何场；并非原片逐像素复刻，也不是产品性能演示。

移植时发现：镜头先到达、对象稍后才显现，会产生空镜头。因此把目的地的低亮度轮廓提前放入同一世界，主体再随触发事件激活。结尾把世界状态与镜头一起固定；相关验证进入测试和 `references/continuous-camera.md`。

补查运动中点与动作完成帧还发现连接端点不能只估算物体边界。已改用真实六角节点生成终点，并增加连接完整性测试。最后验收覆盖 20 个关键帧与编码后的实际画面。

## 继续保留的光照扩展参考

[Deferred Lights](https://youtu.be/R6vQ9VmMz2w) 的 [lightComposite.tsx](https://github.com/motion-canvas/examples/blob/8ffefed144368d33de4b0e451894c718eb95d574/examples/deferred-lighting/src/scenes/lightComposite.tsx) 把光照拆成衰减、颜色、材质相乘和体积叠加，再按时间提示组合。首版提取“让参数变化与画面变化一一对应”的讲解方式，尚未移植其着色器或三维管线。PULSE 的中心光点是装饰性 Canvas 效果，不能称为真实体积光。

## 社区工作流证据

- [OpenAI Developer Community：I Edited This Video 100% With Codex](https://community.openai.com/t/i-edited-this-video-100-with-codex/1373773)：作者报告保留分镜、词级时间戳和选帧自检；人物前景需要时间跟踪。本文没有复现 SAM3/MatAnyone，也不采用作者耗时作为效率承诺。
- [Liamrjohnston/remotion-motion-graphics-skill](https://github.com/Liamrjohnston/remotion-motion-graphics-skill)：检查了 README 的连续场景、相机编排、真实素材和结果留证方法；作者标注展示作品由 Claude 生成。只提取工程方法，不照搬其审美禁令、强制问答或评分审批流程。
- [官方全量 Remotion skills](https://github.com/remotion-dev/skills/tree/7ba4dcf8ebe1626b00baa41e1f2478113719b60b)：沿用已安装的 4.0.535 快照和全部子模块，保持 API、三维、字幕、地图、媒体、云渲染与 SaaS 指导。首版将新经验写入 `references/github-practice.md`。

## 首版落地的经验

1. 把顺序式动画转换成 `f(frame / fps)`，保证跳帧和多进程渲染一致。
2. 对倒向相机位移使用正模运算；重复层的首尾几何必须一致。
3. 用 `save → clip → draw → restore` 限定掩码作用域。
4. 等字体真正加载完再允许截图；字体随项目交付。
5. 用固定版本和 lockfile 复现依赖；逐帧截图与完整编码的验收分开。
6. 把“读过源码”“复现机制”“完成原片复刻”分开记录。首版完成前两项，不声称逐像素复刻。
