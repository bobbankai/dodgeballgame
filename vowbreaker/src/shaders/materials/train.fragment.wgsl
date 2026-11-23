// The passing train (vb_train): steel cars with a stripe, lit windows and passengers, doors,
// smeared along the train at speed; headlights and a destination board at the front, red tail
// lights at the back; the roof and the far side plain.
#define DISABLE_UNIFORMITY_ANALYSIS

#include<vb_common>
#include<vb_hash>
#include<vb_noise>
#include<vb_train>

varying vWorldPos: vec3f;
varying vNormalW: vec3f;
varying vLocal: vec3f;

uniform carSize: vec4f;        // length, height, width, index
uniform trainParams: vec4f;    // speed, time, first car (0/1), last car (0/1)
uniform trainDir: f32;         // +1 heading +x, -1 heading -x
uniform sunDir: vec3f;
uniform sunColor: vec3f;
uniform skyColor: vec3f;
uniform bodyColor: vec3f;
uniform stripeColor: vec3f;
uniform windowColor: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let n = normalize(fragmentInputs.vNormalW);
    let loc = fragmentInputs.vLocal;
    var look: TrainLook;
    look.body = uniforms.bodyColor;
    look.stripe = uniforms.stripeColor;
    look.window = uniforms.windowColor;
    look.speed = uniforms.trainParams.x;
    look.time = uniforms.trainParams.y;
    let l = normalize(uniforms.sunDir);
    let ambient = uniforms.skyColor * 0.6;
    var col = vec3f(0.0);
    if (abs(n.z) > 0.6) {
        // the long sides
        let side = trainShade(loc.x, loc.y, uniforms.carSize.x, uniforms.carSize.w, n, l, uniforms.sunColor, ambient, look);
        col = side.rgb;
    } else if (n.y > 0.6) {
        // the roof: darker steel with vents
        col = uniforms.bodyColor * 0.45 * (0.9 + 0.1 * step(0.5, fract(loc.x * uniforms.carSize.x / 2.0)));
    } else if (abs(n.x) > 0.6) {
        // the ends: on the leading car a face with headlights and a lit destination board
        col = uniforms.bodyColor * 0.6;
        let front = uniforms.trainParams.z > 0.5 && sign(n.x) == sign(uniforms.trainDir);
        let back = uniforms.trainParams.w > 0.5 && sign(n.x) != sign(uniforms.trainDir);
        let q = vec2f(loc.z, loc.y);
        if (front) {
            let lamps = max(1.0 - smoothstep(0.05, 0.08, length(q - vec2f(-0.3, 0.25))), 1.0 - smoothstep(0.05, 0.08, length(q - vec2f(0.3, 0.25))));
            let board = step(abs(q.x), 0.3) * step(abs(q.y - 0.82), 0.06);
            let glass = step(abs(q.x), 0.4) * step(abs(q.y - 0.6), 0.14);
            col = mix(col, vec3f(0.05, 0.07, 0.1), glass);
            col = col + vec3f(4.0, 3.8, 3.2) * lamps;
            col = mix(col, vec3f(1.0, 0.65, 0.15) * 1.6, board);
        }
        if (back) {
            let tail = max(1.0 - smoothstep(0.04, 0.06, length(q - vec2f(-0.32, 0.22))), 1.0 - smoothstep(0.04, 0.06, length(q - vec2f(0.32, 0.22))));
            col = col + vec3f(2.5, 0.1, 0.08) * tail;
        }
    } else {
        // underneath: the bogies, dark
        col = vec3f(0.03);
    }
    fragmentOutputs.color = vec4f(col, 1.0);
}
