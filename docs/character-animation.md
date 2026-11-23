# Hero animation standard

1. **Contact is authoritative (tested).** The axe reaches the cut at `BASIC_ATTACK_CONTACT.melee`; the bowstring and staff release at `BASIC_ATTACK_CONTACT.projectile`. Render poses never create a hit.
2. **Stance foot travels backwards at ground speed (tested).** Roll from heel to a flat sole and then off the toe; walking keeps a longer support phase than running. Drive the cycle with measured displacement, not nominal velocity. Verify both the planted heel/toe and boot clearance on the actual jointed rig.
3. **The weapon has a readable sequence (reviewed at game scale and in close-up).** Axe: brace, load the hips early, cut across, carry the weight into a low recovery. Bow: elevate the bow arm, bring the draw hand toward the jaw, release the string at contact. Staff: gather with both sides of the body, present the orb, settle after release. Use the pattern of a coached archery shot cycle (set, draw, anchor, loose, follow-through); the axe and staff are stylized game moves, not technique reenactments.
4. **Keep joints and grips intact (tested).** Limb lengths remain rigid. The striking arm stays below 105° of elevation, elbow flex stays within 10–152°, and the grip is attached to the hand. Recovery does not freeze at full reach.
5. **Secondary motion follows the actor (reviewed).** Capes lift with forward speed and drag through turns; feet and the upper-body pose remain readable beneath them.
6. **The axe hangs back at rest (tested on the rig, reviewed from both cameras).** Keep the head below the shoulder and behind the grip in idle and travel. Raise it only for the windup, then lead with the cutting edge at the existing contact frame and carry the blade low across the body.
7. **Weight moves over the feet (tested).** Follow the weight-transfer pattern of a planted, bent-knee stance: step, support, then release. The Marauder shifts from his rear leg into his lead leg, the Ranger braces side-on with a quiet chest, and the Witch casts without a large lunge. The pelvis can translate in three axes, but planted feet and the gameplay root do not follow it.
8. **Separate the silhouettes and motion (reviewed).** A short split mantle and asymmetric armor emphasize the Marauder's shoulders; the Witch's collar and split robe emphasize a vertical line; the Ranger's quiver and short cape keep the bow arm clear. From the gameplay camera, the Marauder banks and counter-rotates most, the Witch least, and the Ranger leads turns with the head.

## Review captures

Start `npm run dev`, then run `node qa/animation-review.mjs [output directory]`.
The fixture captures idle, run, windup, contact, and recovery from the game
camera and up close, plus a portrait and a `model-stats.json` report.

The procedural hero models use geometry for the silhouettes, fitted limbs, face
planes, layered armor, and sculpted gear. Fine grain remains in the material
maps. Rivets, guards, and other static details are batched on their owning joint;
no rig pivot, grip, or animation clock depends on the new geometry.

| Hero | Previous asset triangles | Detailed asset triangles | Detailed meshes |
| --- | ---: | ---: | ---: |
| Marauder | 6,132 | 25,378 | 42 |
| Ranger | 5,696 | 30,446 | 50 |
| Witch | 6,046 | 26,778 | 45 |

These are per-model totals, including folded-away or hidden gear. They are not
frame-wide counts, which also include the scene, shadows, and other passes.
