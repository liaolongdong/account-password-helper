---
illustration_id: 02
type: flowchart
style: notion
---

Security Encryption Pipeline — Process Flow

Layout: left-to-right horizontal flow with 5 stages

STEPS:

1. "Master Password" — A simple hand-drawn key icon with "8+ chars" label below. The starting point, user's only secret.
2. "PBKDF2" — A gear/cog icon with "600,000 iterations" label. The key derivation engine. Hand-drawn wobble lines suggest computational intensity.
3. "256-bit Key" — A small golden key shape emerging from the gear. The derived cryptographic key. Label "AES-256-GCM".
4. "Encrypt All" — A shield icon surrounding multiple small document icons (username, password, URL, TOTP). All data encrypted locally.
5. "Session Lock" — A timer icon with "Auto-lock" label and "5/10/30/60 min" subtitle. When timer expires, a small "wipe" arrow points to a re-encrypted document.

CONNECTIONS: Hand-drawn wavy arrows flowing left to right between each step. Each arrow has a small label: "derives" (step 1→2), "produces" (step 2→3), "encrypts" (step 3→4), "protects" (step 4→5). A dashed return arrow from step 5 back to step 4 labeled "on expiry → re-encrypt".

LABELS: "Master Password", "PBKDF2", "600,000 iterations", "256-bit Key", "AES-256-GCM", "Encrypt All", "Session Lock", "Auto-lock", "derives", "produces", "encrypts", "protects", "re-encrypt on expiry"
COLORS: White background (#FFFFFF), Black (#1A1A1A) for all outlines and text, Pastel Blue (#A8D4F0) fill for the shield in step 4, Pastel Yellow (#F9E79F) fill for the key in step 3, Pastel Pink (#FADBD8) fill for the timer in step 5, Dark Gray (#4A4A4A) for arrow labels

STYLE: Minimalist hand-drawn line art, Notion-like aesthetic. Simple doodle-style with intentional wobble. Single-weight black lines. Hand-drawn lettering. Maximum whitespace around each node. Clean horizontal flow. No gradients, no textures.

Clean composition with generous white space. Simple white background. Main elements in a clear left-to-right flow.

Color values (#hex) and color names are rendering guidance only — do NOT display color names, hex codes, or palette labels as visible text in the image.

ASPECT: 16:9
