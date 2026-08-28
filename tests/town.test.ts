import { describe, expect, it } from "vitest"
import { townZoneChoices } from "../src/systems/town"

describe("문지기 존 선택", () => {
  it("마을의 7개 던전을 문지기 선택지로 제공한다", () => {
    const choices = townZoneChoices()

    expect(choices.map((choice) => choice.id)).toEqual([
      "mine", "hall", "catacomb", "bridge", "throne", "cistern", "crucible",
    ])
    expect(choices.filter((choice) => choice.kind === "boss").map((choice) => choice.id))
      .toEqual(["throne", "cistern", "crucible"])
  })
})
