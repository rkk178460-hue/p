# Waterline · 8K 云海光照

基于 `1cd032743461068ae31df5d980f93ceff6c11306` 的海面实现，固定机位 `(0,4.98,21)`，朝向 `(0,3.98,-21)`，海况 46%，太阳时间 17:33，波浪时间 11.25 秒。

| 参数 | 设定 |
| --- | ---: |
| 分辨率 | 7680 × 4320 |
| 网格 | 3072 × 5120 |
| 顶点 | 15,728,641 |
| 三角形 | 31,452,160 |
| 相对网页原始网格采样量 | 256 倍 |
| 固定时刻子像素样本 | 64 |

云层用 `256 × 96 × 256` 的三维密度场与独立的 `64³` 细节体积描述。云层高度在 1250–3350 m 范围内变化。48 次太阳方向采样计算自阴影，另用 3 个样本修正近处侵蚀后的光程。天空光分别沿天顶和四条斜向光路积分，每条光路采样 8 次。观察方向使用曲面云壳及 512 步体积积分，结合 Beer–Lambert 衰减、双 HG 相函数与多重散射近似，生成 `8192 × 4096` 的 HDR 天空。

天空、海面倒影和远景空气光读取同一份 HDR 环境。水体散射和白沫使用环境的半球漫射光，太阳高光、浪尖透光和白沫共用投射到水面的云影。水体透射项按波峰附近的代表性路径长度及三色吸收、背散射系数计算。阵风调节六组细波纹和局部粗糙度，保留法线导数过滤和未分辨坡度方差转移。

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
STILL_WIDTH=1280 STILL_HEIGHT=720 STILL_SAMPLES=2 STILL_GRID_SCALE=8 npm run render
```

可用环境变量包括 `STILL_WIDTH`、`STILL_HEIGHT`、`STILL_SAMPLES`、`STILL_GRID_SCALE`、`STILL_OUTPUT`、`CLOUD_VOLUME`、`CLOUD_WIDTH`、`CLOUD_HEIGHT`、`CLOUD_STEPS`。云缓存对应代码中的固定光照和天气版本。

默认输出 `renders/Waterline-Relit-8K.png`。渲染参数写入 PNG 和同名 JSON。64 个 HDR 样本在 Float32 中累计后执行 Bloom、暗角和一次 ACES/sRGB 转换。程序检查 WGSL 编译、WebGPU 验证错误和像素数值。

实现参考 [Guerrilla 的体积云研究](https://www.guerrilla-games.com/read/nubis-cubed) 和 [Physically Based Rendering 的微表面理论](https://pbr-book.org/4ed/Reflection_Models/Roughness_Using_Microfacet_Theory)。
