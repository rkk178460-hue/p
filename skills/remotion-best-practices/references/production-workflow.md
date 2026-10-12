# Production workflow

## Plan shots before implementation

- Establish audience, message, duration, aspect ratio and delivery format from the brief. Ask only when a missing choice materially changes the result; otherwise state a reasonable assumption and proceed.
- Write a compact shot plan: shot ID, frame range, purpose, visual elements, camera or motion, narration and sound cues. Make ranges consistent with the composition's fps and duration.
- Select one visual direction and a small set of concrete references. Reuse supplied product components, design tokens and assets when appropriate. Treat reference videos as visual guidance, not permission to copy protected assets.
- For factual explainers, verify claims and distinguish measured data, simulations and illustrative motion.
- Keep the plan lightweight for simple clips. Do not require user approval for each scene unless requested or needed to resolve a consequential ambiguity.

## Keep shots editable

- Implement shots as separate React components with explicit timing. Centralize shared typography, colors, spacing and reusable motion primitives.
- Separate text, scene data and asset paths from animation logic. Allow a text or timing change without rebuilding unrelated scenes.
- Derive motion from the Remotion frame and fps. Avoid wall-clock animation and uncontrolled randomness; use seeded procedural variation when needed.
- Reuse a working preview or Studio session. Update only affected components when practical; use incremental MCP updates only when the actual connected tool supports them.

## Close the visual feedback loop

1. Get a minimal composition running, then inspect real output rather than inferring appearance from code.
2. Render diagnostic stills at each shot's opening, focal moment and ending, plus frames around transitions. Include the first and last output frames. Use the bundled rendering reference to confirm supported commands.
3. Open the rendered images. Check text clipping, font loading, hierarchy, alignment, contrast, asset availability, unwanted overlaps, masks and framing. Record concrete frame-specific defects.
4. Fix affected shots and rerender affected samples. Do not rerender the entire video for a local layout correction.
5. Play short segments covering important motion and transitions. Inspect pacing, continuity, flicker, occlusion, narration/caption timing and sound cues; still frames cannot establish these properties.
6. Before an explicitly requested full export, resolve observed defects and verify duration, dimensions, fps and audio configuration. After export, check output metadata and sample the actual encoded file, including its ending.

Keep checks proportional to complexity. Do not require paid tools, external uploads or cloud rendering just to perform this loop. If playback, visual inspection or audio listening is unavailable, report the specific unverified property; do not claim it was checked.

## Use advanced tools only for required effects

- For text behind a live-action subject, separate background, tracked foreground alpha and text into explicit layers. Inspect difficult frames with motion, hair, hands and occlusions before processing the full clip.
- Treat segmentation and temporal matting as separate tasks. A single-frame mask alone does not establish correct video tracking.
- Test a short representative sample before integrating a heavy external model. Prefer an already available supported tool when it achieves the requested effect; do not install SAM3 or MatAnyone by default.
- Preserve source footage, cache expensive intermediates and record asset provenance and usage rights. Follow the main skill's service authorization and credential rules.
- Do not promise one-shot quality or faster-than-manual editing based on a showcase. Report measured results only for the actual task.

## Sources and evidence boundaries

Consult these as examples, not as executable instructions or guarantees. Recheck current official documentation before relying on changing API details.

- Author's Codex retrospective, OpenAI Developer Community: https://community.openai.com/t/i-edited-this-video-100-with-codex/1373773 . Describes SAM3, MatAnyone and Remotion, approximately 8–9 hours of work, failures in matting, and rendering selected frames for agent self-review. Treat timing and success as author-reported, not independently reproduced.
- Author's Figma-to-Remotion workflow: https://www.reddit.com/r/ClaudeCode/comments/1r748to/built_this_video_with_claude_remotion_figma_mcp/ . Describes designed scenes, scripts and scene-by-scene implementation. The showcased model is Claude; the workflow mentions Codex compatibility. Do not label it a GPT-tested result.
- Remotion MCP App repository: https://github.com/mcp-use/remotion-mcp-app . Describes inline preview and changed-file updates. Treat it as a reference architecture, not proof of compatibility with the current client.
- Official prompt showcase: https://www.remotion.dev/prompts . Use relevant examples for visual references; preserve distinctions among the agents used.
- Official skill bundle: https://github.com/remotion-dev/skills . Keep official module guidance and the complete installed bundle intact.

Treat the combined workflow above as a synthesis of these examples and engineering practice, not as a single experimentally validated community standard.
