# Waterline · 8K 海面与体积云

基于 `1cd032743461068ae31df5d980f93ceff6c11306` 的海面实现，固定机位 `(0,4.98,21)`，朝向 `(0,3.98,-21)`，海况 46%，太阳时间 17:33，波浪时间 11.25 秒。

| 参数 | 设定 |
| --- | ---: |
| 分辨率 | 7680 × 4320 |
| 网格 | 3072 × 5120 |
| 顶点 | 15,728,641 |
| 三角形 | 31,452,160 |
| 相对网页原始网格采样量 | 256 倍 |
| 固定时刻子像素样本 | 64 |

## 这次修正了什么

1. 上一版在 8 位画布上完成最后一次转换。即使前面累积了 64 个样本，暗水面相近的颜色仍会在写 PNG 前合并。这一版把线性场景、子像素累积和最终颜色转换保留在 Float32 中，按像素直接读取。只给泛光另备一份可过滤的半精度输入。导出时同时生成无抖动的 16 位 RGB 母版，以及使用亮度抖动的 8 位 RGB 显示版。三个颜色通道使用同一个抖动值，避免暗部出现彩点。
2. 近处波面缺少能打断反光的短波，远处的纹理容易挤成细线。在原有六层波纹上加入四组风生短波，波长从 7.4 到 64 厘米。波纹进入像素的分辨极限时，解析出的坡度逐渐降低，未分辨部分转入镜面粗糙度。天空环境重新分配角度采样，将较密的采样留给镜头前方和低仰角。天空和倒影使用同一张图与同一套方向映射。
3. 旧云层的轮廓主要由同一套高度曲线控制，几团云有相似的平底和圆顶。这次按上升气流分别控制凝结高度、宽度和云顶，同一团云内可以长出高低不同的塔状结构。风切变让云顶相对云底偏移，三种尺度的侵蚀产生疏密不同的云缘。观察光线、太阳光和环境光都采样侵蚀后的密度。比较沿用上一版机位、海况及太阳时间，云场重新取景，使阳光能从云隙落到水面。

云场高度范围为 1250–3350 米。主体密度网格为 `384 × 128 × 384`，细节体积为 `96³`。自阴影沿太阳方向使用 72 步积分，近处额外采样 3 次修正局部明暗。环境光使用五个方向，每个方向 8 步。观察光线沿曲面云壳积分，最多 512 步，达到光学不透明后提前结束，生成 `8192 × 4096` 的 HDR 天空。水体散射和白沫使用同一天空的半球漫射光。

太阳视直径约 0.53°。直接镜面高光使用带粗糙尾部的各向异性 Beckmann 分布，并和太阳盘共用辐射与角尺寸。反射环境使用三方向采样和按角度足迹选择的 mip 层级。泛光输入设有亮度上限，HDR 成图保留原有高光能量进入色调映射。

`enhance-source.mjs` 只对离线导入副本应用材质改动和 32 位网格索引，保留网页的交互性能预算。运行前核对原始 `main.js` 的 Git blob SHA，避免静默套用到不兼容版本。

## 运行

安装 Node.js 22 或更新版本，并提供可用的原生 WebGPU 图形适配器。验证环境用 Mesa 25.0.7 / LLVM 19 的 Lavapipe 软件 Vulkan 执行光栅化和像素回读。

```sh
cd waterline/offline
npm ci
npm run render
```

默认使用 Vulkan。其他平台可设置 `WATERLINE_BACKEND` 为 Dawn 支持的后端；Linux 软件渲染可通过 Vulkan 标准的 `VK_DRIVER_FILES` 指向已安装的 Lavapipe ICD。程序请求的设备限额为 16384 的二维纹理尺寸和 1 GiB 的单缓冲上限。

快速查看构图：

```sh
STILL_WIDTH=1280 STILL_HEIGHT=720 STILL_SAMPLES=2 STILL_GRID_SCALE=4 CLOUD_VOLUME=192 CLOUD_WIDTH=3072 CLOUD_HEIGHT=1536 CLOUD_STEPS=256 npm run render
```

可用环境变量包括 `STILL_WIDTH`、`STILL_HEIGHT`、`STILL_SAMPLES`、`STILL_GRID_SCALE`、`STILL_OUTPUT`、`CLOUD_VOLUME`、`CLOUD_WIDTH`、`CLOUD_HEIGHT`、`CLOUD_STEPS`。云缓存对应代码中的固定光照和天气版本。

默认输出两个同分辨率的 sRGB PNG，均来自同一次渲染。母版为 `renders/Waterline-Relit-8K.png`，每通道 16 位。显示版为 `renders/Waterline-Relit-8K-display.png`，每通道 8 位，在量化前加入高通三角分布抖动。PNG 与同名 JSON 中保存实际渲染参数。程序检查 WGSL 编译、WebGPU 验证错误及输出数值。

实现参考 [Guerrilla 的体积云研究](https://www.guerrilla-games.com/read/nubis-cubed) 和 [Physically Based Rendering 的微表面理论](https://pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory)。
