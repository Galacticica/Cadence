import { describe, expect, it } from "vitest";
import {
  assemble,
  grooveMeasure,
  parse,
  renderOutput,
  run,
  runToCompletion,
  RuntimeError,
  type Instruction,
} from "../src/index.js";
import {
  ARITH_35,
  BIG_10_POW_32,
  BIG_70000,
  COUNTDOWN,
  EVEN_ODD,
  HELLO_WORLD,
  maxProgram,
  multiBarBranch,
  REPEAT_ZERO,
  SPLIT_42,
  STACK_SWAP,
  STARS_3x3,
  TRUTH_MACHINE,
} from "./fixtures.js";

const exec = (instrs: Instruction[], inputs: bigint[] = [], maxBars?: number) =>
  runToCompletion(parse(assemble(instrs)), inputs, { maxBars });

const output = (instrs: Instruction[], inputs: bigint[] = []) =>
  renderOutput(exec(instrs, inputs));

describe("SPEC §6 programs", () => {
  it("countdown prints 5 4 3 2 1", () => {
    expect(output(COUNTDOWN)).toBe("5 4 3 2 1 ");
  });

  it("truth machine: 0 prints once and halts", () => {
    const events = exec(TRUTH_MACHINE, [0n]);
    expect(renderOutput(events)).toBe("0 ");
    expect(events.at(-1)).toMatchObject({ type: "halt" });
  });

  it("truth machine: 1 loops forever (bounded run, no halt)", () => {
    const events = exec(TRUTH_MACHINE, [1n], 50);
    const outs = events.filter((e) => e.type === "outN");
    expect(outs.length).toBeGreaterThan(5);
    expect(outs.every((e) => e.type === "outN" && e.value === 1n)).toBe(true);
    expect(events.some((e) => e.type === "halt")).toBe(false);
  });

  it("prints Hello, World!", () => {
    expect(output(HELLO_WORLD)).toBe("Hello, World!");
  });

  it("(3 + 4) × 5 = 35", () => {
    expect(output(ARITH_35)).toBe("35 ");
  });

  it("splits 42 into tens and ones", () => {
    expect(output(SPLIT_42)).toBe("4 2 ");
  });

  it("builds 70,000 in six bars", () => {
    expect(output(BIG_70000)).toBe("70000 ");
  });

  it("is arbitrary-precision: 10^32 exactly", () => {
    expect(output(BIG_10_POW_32)).toBe("100000000000000000000000000000000 ");
  });

  it("even/odd prints E and O", () => {
    expect(output(EVEN_ODD, [4n])).toBe("E");
    expect(output(EVEN_ODD, [7n])).toBe("O");
  });

  it("max via SKIPGE", () => {
    expect(output(maxProgram(3, 9))).toBe("9 ");
    expect(output(maxProgram(9, 3))).toBe("9 ");
    expect(output(maxProgram(5, 5))).toBe("5 ");
  });

  it("swaps registers through the stack", () => {
    expect(output(STACK_SWAP)).toBe("2 1 ");
  });

  it("nests repeat blocks: 3×3 stars", () => {
    expect(output(STARS_3x3)).toBe("***\n***\n***\n");
  });

  it("REPEAT_START 0 skips its block entirely", () => {
    expect(output(REPEAT_ZERO)).toBe("7 ");
  });

  it("a skip jumps a whole REPEAT_START 1 block", () => {
    expect(output(multiBarBranch(0))).toBe("9 ");
    expect(output(multiBarBranch(1))).toBe("1 9 ");
  });
});

describe("control-flow details", () => {
  it("groove bars are transparent to skips (SPEC §5 rule 3)", () => {
    // SKIPNZ R1 must skip OUTN even with a groove bar in between.
    const g = assemble([
      { opcode: "LOADI", rd: 1, imm: 1 },
      { opcode: "SKIPNZ", rd: 1 },
    ]);
    g.push(grooveMeasure());
    g.push(
      ...assemble([
        { opcode: "OUTN", rd: 1 },
        { opcode: "LOADI", rd: 2, imm: 8 },
        { opcode: "OUTN", rd: 2 },
      ]),
    );
    expect(renderOutput(runToCompletion(parse(g)))).toBe("8 ");
  });

  it("falling off the end halts", () => {
    const events = exec([{ opcode: "LOADI", rd: 1, imm: 1 }]);
    expect(events.at(-1)).toMatchObject({ type: "halt", bar: 1 });
  });

  it("TONE yields a midi event", () => {
    const events = exec([
      { opcode: "LOADI", rd: 1, imm: 65 },
      { opcode: "TONE", rd: 1 },
    ]);
    expect(events).toContainEqual({ type: "tone", midi: 65, bar: 2 });
  });

  it("IN resumes with the provided value", () => {
    const program = parse(
      assemble([
        { opcode: "IN", rd: 1 },
        { opcode: "OUTN", rd: 1 },
      ]),
    );
    const gen = run(program);
    const first = gen.next();
    expect(first.value).toMatchObject({ type: "input", reg: 1 });
    const second = gen.next(123n);
    expect(second.value).toMatchObject({ type: "outN", value: 123n });
  });
});

describe("run() generator API", () => {
  it("barEvents traces the execution order, loops included", () => {
    const events = runToCompletion(parse(assemble(COUNTDOWN.slice(0, 7))), [], {
      barEvents: true,
    });
    const bars = events.filter((e) => e.type === "bar").map((e) => e.bar);
    // 2 loads, then the while-block (3,4,5,6) five times, the failing
    // re-check of bar 3, and HALT at bar 7
    expect(bars).toEqual([
      1, 2,
      3, 4, 5, 6,
      3, 4, 5, 6,
      3, 4, 5, 6,
      3, 4, 5, 6,
      3, 4, 5, 6,
      3, 7,
    ]);
  });

  it("resuming an input event with no value defaults the register to 0", () => {
    const program = parse(
      assemble([
        { opcode: "IN", rd: 2 },
        { opcode: "OUTN", rd: 2 },
      ]),
    );
    const gen = run(program);
    expect(gen.next().value).toMatchObject({ type: "input", reg: 2 });
    expect(gen.next().value).toMatchObject({ type: "outN", value: 0n });
  });

  it("maxBars stops silently without a halt event", () => {
    const looper = parse(
      assemble([
        { opcode: "LOADI", rd: 1, imm: 1 },
        { opcode: "REPEAT_WHILE", rd: 1 },
        { opcode: "REPEAT_END" },
      ]),
    );
    const events = runToCompletion(looper, [], { maxBars: 10 });
    expect(events.some((e) => e.type === "halt")).toBe(false);
  });
});

describe("renderOutput", () => {
  it("renders numbers with trailing spaces and codepoints as characters", () => {
    expect(
      renderOutput([
        { type: "outN", value: 42n, bar: 1 },
        { type: "outC", codepoint: 0x2764, bar: 2 }, // ❤
        { type: "outN", value: -7n, bar: 3 },
        { type: "tone", midi: 60, bar: 4 }, // silent in text output
        { type: "halt", bar: 5 },
      ]),
    ).toBe("42 ❤-7 ");
  });
});

describe("runtime errors", () => {
  it("throws on division by zero, with the bar number", () => {
    const instrs: Instruction[] = [
      { opcode: "LOADI", rd: 1, imm: 5 },
      { opcode: "DIV", rd: 1, rs: 2 },
    ];
    expect(() => exec(instrs)).toThrowError(RuntimeError);
    expect(() => exec(instrs)).toThrowError("bar 2: division by zero");
  });

  it("throws on pop from an empty stack", () => {
    expect(() => exec([{ opcode: "POP", rd: 1 }])).toThrowError(
      "bar 1: pop from empty stack",
    );
  });

  it("refuses to run a program with syntax errors", () => {
    const program = parse(assemble([{ opcode: "REPEAT_END" }]));
    expect(() => runToCompletion(program)).toThrowError(/syntax error/);
  });
});
