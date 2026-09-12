# Swim Practice

COMP 590/790 Assignment 2: Build Your Own Game Engine, Part I

A freestyle swimmer working a lane, flipping at each wall. Open `index.html` in a browser. No libraries, no build step.

**Hierarchy.** The swimmer's torso is the root. Its children are two upper arms, two thighs, and the head, and each upper arm and thigh has a child of its own (forearm with hand, shin with foot). Joint angles are local, so the elbow angle is relative to the upper arm, the left side is the right side mirrored with `scaleY = -1`, and the flip turn comes from rotating and scaling the torso alone. The pace clock is a second hierarchy: its hands are children of the face.

**Controls.** Speed scrubs the animation from paused to 2x. Show joints draws each object's local axes, red for x and green for y.

**AI assistance.** Written with help from Claude Opus 5 (Anthropic), September 2026. I chose the scene and the object hierarchy, directed the design, and iteratively worked to get to a product I liked.
