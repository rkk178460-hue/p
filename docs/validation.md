# 首版实际验收结果

执行日期：2026-10-13。环境：Linux、Node.js 24.19.0、npm 11.9.0、FFmpeg 6.1.1；Remotion 全家桶 4.0.535。渲染使用兼容 Chrome Headless Shell、CPU 绘图和 2 个并行帧。

## 完成项

| 检查 | 结果 |
| --- | --- |
| 从 lockfile 重新执行 `npm ci --ignore-scripts --no-audit --no-fund` | 成功；未依赖先前 node_modules 才能运行 |
| `npm run check` | 通过 |
| `npm test` | 5/5 通过：公共周期、反向相机、任意跳帧、实际绘图调用一致性、视差首尾绘图一致性 |
| 全量 skill 验证 | 元数据有效；144 个资源完整生成到单文件；SHA-256 清单匹配；相对资源链接全部可解析 |
| 官方 bundle 对照 | 141 个上游文件均存在；SKILL.md、voiceover.md、agents/openai.yaml 保留此前本地适配，其余上游文件字节一致 |
| PULSE 导出 | 15.000 秒，900 帧，1920×1080，60 fps，H.264，yuv420p，无音轨 |
| ParallaxStudy 导出 | 6.000 秒，360 帧，同分辨率/帧率/编码，无音轨 |
| MaskTrailsStudy 导出 | 4.000 秒，240 帧，同分辨率/帧率/编码，无音轨 |
| 三段视频的 ffprobe 帧计数与 FFmpeg `-xerror` 全片解码 | 全部通过 |
| 验收脚本反例 | 用默认 15 秒标准验证 6 秒视频，正确拒绝帧数与时长不符的文件 |
| 结果文件完整性 | `docs/media-manifest.json` 保存所有交付媒体的字节数与 SHA-256 |

## 视觉检查与修改

检查了主片第 0、120、290、300、420、590、600、720、899 帧的诊断图。发现线条层次偏暗，调亮隧道与轨道，并放大中心投影后重新检查。导出后再次检查相同抽帧，加查第 810 帧的收尾结构。

检查了编码视差小样第 0、90、180、270、359 帧和遮罩小样第 0、60、120、239 帧：图层覆盖边缘，没有标题裁切，遮罩限制在各自轨迹内。主片计划中的首尾黑场正常。

独立 skill 使用检查发现“平铺补边”与“时间无缝循环”容易混淆，已将视差相机改为每 6 秒移动 1280 单位，并对所有图层验证公共周期。遮罩轨迹改为 72/144/216 单位每秒，与 144 单位空间周期构成 4 秒共同周期。经验已写入 skill。主片采用淡入淡出，未设计成循环片。

## 验证边界

- 云端浏览器不能访问此本地 Studio 地址，未完成 Studio UI 内的播放观看。已生成本地 Studio 服务并通过 Remotion 渲染确认 composition 可运行。
- 执行环境的 Node 网络接口查询出现 `uv_interface_addresses` 错误。验收进程使用位于临时检查目录的 loopback shim 和 `NODE_OPTIONS`，没有修改项目代码或依赖代码。普通电脑无需该适配；本环境不能据此声称不带适配的 Studio 命令已通过。
- 使用已有的兼容 Chrome Headless Shell 进行渲染；没有重新测试首次浏览器下载。
- 连续播放的主观观感、手机实机性能和原案例逐像素一致性未验证。截图检查和解码检查不能证明这些性质。
- 所有视频为无声程序动画。没有旁白、音乐、真实三维光照、SAM3/MatAnyone 处理或外部服务调用。

## 复验命令

```bash
cd examples/pulse
npm ci
npm run check
npm test
npm run qa
npm run render
npm run render:parallax
npm run render:mask
cd ../..
python scripts/build_skill.py --check
python scripts/verify_video.py examples/pulse/out/pulse.mp4
python scripts/verify_video.py examples/pulse/out/parallax.mp4 --duration 6
python scripts/verify_video.py examples/pulse/out/mask-trails.mp4 --duration 4
```
