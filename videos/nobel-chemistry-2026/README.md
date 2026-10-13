# 2026 诺贝尔化学奖｜微小的不对称，如何被放大？

项目完成了一部 16 场、4 分 57 秒的原创程序动画解释片，结构、旁白、字幕、MP4 输出、源码和 QA 文件均已整理为本次对话的交付包。

## 最终交付规格

- 1280 × 720, 24 fps, 297.000 s, H.264 + AAC。
- 分镜 16 场，包含对映异构体、生命同手性、ee、Kagan 的非线性效应、Soai 的不对称自催化、手性放大和应用边界。
- 使用离线 Python/Pillow 绘制、FFmpeg 编码；可选 espeak 中文合成解说和原创程序环境配乐。
- 中文字幕随画面烧录，同时提供 SRT。
- 完整视频通过 ffprobe、全片 FFmpeg 严格解码和时长核对。
- 图形是原创概念示意；不是实验曲线，也不是关于生命起源的历史证明。

## 文件交付

此 GitHub 路径记录已完成的制作与事实校对。**可执行源代码、分镜 JSON、字幕、校验脚本和最终 MP4** 已作为本次 ChatGPT 项目的下载归档交付；当前没有向 GitHub 上传大型视频或二进制文件。归档解包后可运行：

```bash
python -m pip install -r requirements.txt
python render.py --preview
python render.py --output chemistry-nobel-2026.mp4
python verify.py chemistry-nobel-2026.mp4
```

其中 `render.py` 按帧绘制原创几何动画，`storyboard.json` 保存所有时长、旁白与场景数据，`subtitles.zh.srt` 是可编辑字幕。离线配音 `espeak` 的机械音色属于已知限制；可使用 `--no-voice` 重新输出仅含音乐与字幕的版本。

## 核查资料（2026-10-07/08）

1. 瑞典皇家科学院官方公告：https://www.kva.se/en/news/the-nobel-prize-in-chemistry-2026/
2. ACS 新闻稿：https://www.acs.org/pressroom/newsreleases/2026/october/acs-president-comments-on-award-of-2026-nobel-prize-in-chemistry.html
3. Nature 新闻与分析：https://www.nature.com/articles/d41586-026-03093-0
4. 伊利诺伊大学关于 Soai 反应机理的说明：https://chemistry.illinois.edu/news/2026-10-08/nobel-chemistry-announcement-spotlights-scott-denmarks-soai-research

奖项授予 Henri B. Kagan、Kenso Soai，获奖理由是“不对称有机合成中的非线性效应与自催化的发现”。时间节点：1986、1995、2003。

## 验收

共 7128 帧；`ffprobe` 实测时长 297.000 秒；编码 H.264 yuv420p + AAC；1280×720 / 24 fps；`ffmpeg -xerror` 全片解码成功。所有图表、动画和语音可通过源代码再次生成。