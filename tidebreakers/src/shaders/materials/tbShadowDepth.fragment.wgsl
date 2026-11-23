varying vDepth: f32;
@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
  fragmentOutputs.color = vec4f(input.vDepth, 0.0, 0.0, 1.0);
}
