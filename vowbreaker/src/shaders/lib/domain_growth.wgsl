// Domain growth (domainFloor.fragment): while a domain is open, something grows across its floor
// from the caster's feet: a reaction-diffusion field (the same Gray-Scott pass as the curse rot,
// compute/curse_rot.wgsl, run by src/render/Domain.ts) with rates chosen per domain so each grows
// its own pattern, drawn in the domain's own way:
//
//   0 the Unrung Bell     rings and spots (f .030, k .062): bronze inlay that catches the dusk
//   1 Folded Prayers      coral fronds (f .055, k .062): red ink lines bleeding into the paper
//   2 Mirror Lake         dividing cells (f .0367, k .0649): little silver moons splitting in two
//   3 Night Parade        a maze (f .029, k .057): lantern-lit grooves glowing red
//   4 the burning memory  branching cracks (f .039, k .058): embers in a charred floor
//
// texel: r = A (clean), g = B (growth), b = age

// the rates each domain grows with
fn domainGrowthRates(id: i32) -> vec2f {
    switch id {
        case 0: {
            return vec2f(0.030, 0.062);
        }
        case 1: {
            return vec2f(0.055, 0.062);
        }
        case 2: {
            return vec2f(0.0367, 0.0649);
        }
        case 3: {
            return vec2f(0.029, 0.057);
        }
        default: {
            return vec2f(0.039, 0.058);
        }
    }
}

// the growth drawn into the floor's colour, with what it adds as light
struct DomainGrowthLook {
    col: vec3f,
    glow: vec3f,
}

fn domainGrowthLook(id: i32, col0: vec3f, g: vec4f, p: vec3f, t: f32) -> DomainGrowthLook {
    var o: DomainGrowthLook;
    o.col = col0;
    o.glow = vec3f(0.0);
    let b = g.g;
    let line = smoothstep(0.16, 0.24, b);
    let rim = smoothstep(0.08, 0.16, b) * (1.0 - line);
    let pulse = 0.7 + 0.3 * sin(t * 2.0 - length(p.xz) * 0.8);
    switch id {
        case 0: {
            // bronze inlay: dark bronze with a bright edge
            o.col = mix(o.col, vec3f(0.35, 0.22, 0.08), line);
            o.glow = vec3f(1.0, 0.7, 0.3) * rim * 0.6 * pulse;
        }
        case 1: {
            // red ink lines in the paper
            o.col = mix(o.col, vec3f(0.55, 0.06, 0.05), line * 0.9);
            o.col = mix(o.col, o.col * vec3f(1.0, 0.8, 0.8), rim * 0.5);
        }
        case 2: {
            // silver moons on the black water
            o.col = mix(o.col, vec3f(0.75, 0.82, 0.95), line * 0.8);
            o.glow = vec3f(0.6, 0.7, 1.0) * rim * 0.5;
        }
        case 3: {
            // grooves glowing lantern red
            o.col = mix(o.col, o.col * 0.25, line);
            o.glow = vec3f(1.0, 0.25, 0.1) * (line * 0.5 + rim) * pulse;
        }
        default: {
            // embers in charred cracks
            o.col = mix(o.col, vec3f(0.05, 0.03, 0.02), line);
            o.glow = vec3f(1.0, 0.4, 0.08) * rim * 1.2 * (0.6 + 0.4 * valueNoise2(p.xz * 3.0 + t));
        }
    }
    return o;
}
