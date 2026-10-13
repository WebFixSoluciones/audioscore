// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { fixture } from "./fixtures";
import { useEditor } from "@/lib/editor/store";
import { useMixer } from "@/lib/editor/mixer-store";
vi.mock("@/components/audio/WaveformEditor", () => ({
  WaveformEditor: () => null,
}));
vi.mock("@/components/audio/MidiPlayback", () => ({
  MidiPlayback: () => null,
}));
vi.mock("@/components/audio/StemPlayback", () => ({
  StemPlayback: () => null,
}));
vi.mock("@/components/audio/MusicalAnalysis", () => ({
  MusicalAnalysis: () => null,
}));
vi.mock("@/components/audio/PracticePanel", () => ({
  PracticePanel: () => null,
}));
vi.mock("@/components/editor/PianoRoll", () => ({ PianoRoll: () => null }));
vi.mock("@/components/editor/EventInspector", () => ({
  EventInspector: () => null,
}));
vi.mock("@/components/scores/ScoreViewer", () => ({
  ScoreViewer: () =>
    createElement(
      "div",
      { "data-testid": "score-source" },
      useEditor((s) => s.sourceId),
    ),
}));
vi.mock("@/components/scores/NotationPreview", () => ({
  NotationPreview: () => null,
}));
vi.mock("@/components/scores/TablatureViewer", () => ({
  TablatureViewer: () => null,
}));
vi.mock("@/lib/audio/browser-features", () => ({
  acousticFeatures: vi.fn().mockResolvedValue({
    duration: 4,
    rms: 0.2,
    spectralCentroidHz: 1000,
    clippingPercent: 0,
    sampleRate: 44100,
  }),
}));
vi.mock("@/lib/audio/local/client", () => ({
  analyzeOnMachine: vi.fn(),
  localRequest: vi.fn(),
  waitForMachineJob: vi.fn(),
}));
vi.mock("@/lib/firebase/client", () => ({
  api: vi.fn(),
  clientFirebase: vi.fn(),
  firebaseConfigured: true,
}));
vi.mock("file-saver", () => ({ saveAs: vi.fn() }));
import { analyzeOnMachine, localRequest } from "@/lib/audio/local/client";
import { acousticFeatures } from "@/lib/audio/browser-features";
import { MusicEditor } from "@/components/editor/MusicEditor";
import { LocalProjects } from "@/components/projects/LocalProjects";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
describe("single audio workspace with optional projects", () => {
  it("does not restore the previous audio when a slow inspection finishes after clearing the studio", async () => {
    let finish!: (value: Awaited<ReturnType<typeof acousticFeatures>>) => void;
    vi.mocked(acousticFeatures).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL() {
          return "blob:slow-audio";
        }
        static revokeObjectURL() {}
      },
    );
    render(createElement(MusicEditor, { localEngine: true }));
    fireEvent.change(screen.getByLabelText("Abrir archivo de audio"), {
      target: {
        files: [new File(["wav"], "Anterior.wav", { type: "audio/wav" })],
      },
    });
    act(() => window.dispatchEvent(new Event("audioscore:new-audio")));
    await act(async () =>
      finish({
        duration: 4,
        rms: 0.2,
        spectralCentroidHz: 1000,
        clippingPercent: 0,
        sampleRate: 44100,
      }),
    );
    expect(useEditor.getState().document.title).toBe("Nuevo audio");
    expect(useEditor.getState().document.durationSeconds).toBe(0);
    expect(useEditor.getState().document.events).toHaveLength(0);
  });
  it("starts empty, shows one track list, chooses each score, saves only on request and clears for the next audio", async () => {
    const document = fixture();
    document.sources[0].id = "demucs-piano";
    document.events.forEach((e) => {
      e.sourceId = "demucs-piano";
    });
    document.sources.push({
      ...document.sources[0],
      id: "demucs-guitar",
      name: "Guitarra",
      nameEs: "Guitarra",
      program: 24,
    });
    document.events.push({
      ...document.events[0],
      id: "guitar-note",
      sourceId: "demucs-guitar",
    });
    const result = {
      document,
      peaks: [],
      originalUrl: "/original.wav",
      urls: { "demucs-piano": "/piano.wav", "demucs-guitar": "/guitar.wav" },
    };
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL() {
          return "blob:test-audio";
        }
        static revokeObjectURL() {}
      },
    );
    vi.mocked(analyzeOnMachine).mockImplementation(
      async (_file, _report, _signal, onJob) => {
        onJob("draft-id");
        return result;
      },
    );
    vi.mocked(localRequest).mockImplementation(async (path) =>
      path.endsWith("waveforms")
        ? { peaks: { "demucs-piano": [0.2], "demucs-guitar": [0.1] } }
        : { saved: true },
    );
    useMixer.getState().configure(Object.keys(result.urls));
    const view = render(createElement(MusicEditor, { localEngine: true }));
    expect(screen.queryByText("Faded - prueba local")).toBeNull();
    expect(screen.queryByText("Guardados en este equipo")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Guardar como proyecto",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Abrir archivo de audio"), {
      target: {
        files: [new File(["wav"], "Mi audio.wav", { type: "audio/wav" })],
      },
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Separar y transcribir",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    fireEvent.change(screen.getByLabelText("Calidad de separación"), {
      target: { value: "careful" },
    });
    fireEvent.change(screen.getByLabelText("Seguimiento de tempo"), {
      target: { value: "adaptive" },
    });
    fireEvent.click(screen.getByLabelText("Reducir ruido para transcribir"));
    fireEvent.click(
      screen.getByRole("button", { name: "Separar y transcribir" }),
    );
    await screen.findByRole("region", {
      name: "Mezclador de pistas separadas",
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Guardar como proyecto",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(view.container.querySelectorAll(".stem-panel").length).toBe(0);
    expect(vi.mocked(analyzeOnMachine).mock.calls[0][4]).toEqual({
      quality: "careful",
      tempo: "adaptive",
      reduceNoise: true,
      detectBars: true,
    });
    expect(view.container.querySelectorAll(".separated-track").length).toBe(2);
    expect(view.container.querySelectorAll(".track-title small").length).toBe(
      0,
    );
    expect(
      vi
        .mocked(localRequest)
        .mock.calls.some(([path]) => path.endsWith("/project")),
    ).toBe(false);
    fireEvent.change(screen.getByLabelText("Pista de partitura"), {
      target: { value: "demucs-guitar" },
    });
    expect(screen.getByTestId("score-source").textContent).toBe(
      "demucs-guitar",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar como proyecto" }),
    );
    await screen.findByRole("button", { name: "Guardar cambios" });
    const save = vi
      .mocked(localRequest)
      .mock.calls.find(([path]) => path === "jobs/draft-id/project");
    expect(save?.[1]?.method).toBe("POST");
    expect(JSON.parse(save![1]!.body as string).document.events.length).toBe(3);
    expect(
      JSON.parse(save![1]!.body as string).mix["demucs-piano"].volume,
    ).toBe(0.75);
    fireEvent.click(screen.getByRole("button", { name: "Nuevo audio" }));
    expect(
      screen.queryByRole("region", { name: "Mezclador de pistas separadas" }),
    ).toBeNull();
    expect(useEditor.getState().document.sources).toEqual([]);
    expect(
      (
        screen.getByRole("button", {
          name: "Guardar como proyecto",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    act(() => window.dispatchEvent(new Event("audioscore:new-audio")));
    expect(useEditor.getState().document.events).toEqual([]);
  });
  it("lists only explicit projects on the separate library page", async () => {
    vi.mocked(localRequest).mockResolvedValue({ jobs: [] });
    render(createElement(LocalProjects));
    await screen.findByText("Aún no has guardado proyectos.");
    expect(
      screen.getByRole("link", { name: "Abrir estudio" }).getAttribute("href"),
    ).toBe("/dashboard/studio");
    expect(screen.queryByText("Faded - prueba local")).toBeNull();
  });
});
