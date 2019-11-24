import {interval, Observable, Subscription} from "rxjs";
import {filter, map, scan} from "rxjs/operators";

enum PulseType {
    Quarter = 1,
    Eighth = 2,
    Sixteenth = 4
}

interface Period {
    pulseIndex: number,
    current: {
        duration: number; // in pulses
        currPeriodIndex: number;
    }
}

interface NoteEvent {
    curr?: number;
    previous?: number;
}

function createPeriodStream(bpm: number, pulseType: PulseType, maxDuration: number, minDuration: number): Observable<Period> {
    const pulseMilliseconds = 60 / bpm * 1000 / pulseType;

    return interval(pulseMilliseconds)
        .pipe(
            scan((note, i) => {
                const isComplete = note.current.currPeriodIndex + 1 >= note.current.duration;
                return {
                    pulseIndex: i,
                    current: isComplete
                        ? {
                            duration: Math.floor(Math.random() * (maxDuration - minDuration + 1) + minDuration),
                            currPeriodIndex: 0
                        }
                        : {
                            ...note.current,
                            currPeriodIndex: note.current.currPeriodIndex + 1
                        }
                };
            }, {
                pulseIndex: 0,
                current: {
                    duration: 0,
                    currPeriodIndex: 0
                }
            })
        );

}

function createNoteEventStream(notes: number[], bpm: number, pulseType: PulseType, maxDuration: number, minDuration: number) {
    const phraseLength = pulseType * 4;

    const period$ = createPeriodStream(bpm, pulseType, maxDuration, minDuration);

    return period$.pipe(
        filter(pulse => { // filter to only start of periods
            return pulse.current.currPeriodIndex + 1 === pulse.current.duration
        }),
        filter(pulse => Math.floor(pulse.pulseIndex / phraseLength) % 2 === 0), // silence every second phrase
        map(() => {
            const notesIndex = Math.floor(Math.random() * notes.length);
            return notes[notesIndex];
        }),
        scan<number, NoteEvent>((event, curr) => {
            return {
                curr: curr,
                previous: event.curr
            };
        }, {}),
    );
}

class Main {
    private audioContext: AudioContext = new AudioContext();
    private osc: MyOscillator;
    private noteEventSubscription: Subscription | undefined;

    constructor() {
        const startButton = document.getElementById("start");
        if (startButton) {
            startButton.addEventListener('click', () => this.start())
        }

        const stopButton = document.getElementById("stop");
        if (stopButton) {
            stopButton.addEventListener('click', () => this.stop())
        }

        this.osc = new MyOscillator(this.audioContext);

        navigator.requestMIDIAccess()
            .then((midiAccess: WebMidi.MIDIAccess) => {
                const inputs = Array.from(midiAccess.inputs.values());

                inputs
                    .filter(i => i.manufacturer === 'Roland') // only care about MIDI keyboard
                    .forEach((input) => {
                        input.onmidimessage = this.handleMidiMessage;
                    })
            });

    }


    start() {
        const notes = [60, 63, 65];
        const bpm = 80;
        const pulseType = PulseType.Eighth;
        const maxDuration = 2; // in pulses
        const minDuration = 1;

        const noteOnStream$ = createNoteEventStream(notes, bpm, pulseType, maxDuration, minDuration);

        this.noteEventSubscription = noteOnStream$.pipe(
        ).subscribe(
            noteEvent => {
                this.playNote(noteEvent.curr!!);
            }
        );
    }

    stop() {
        this.noteEventSubscription && this.noteEventSubscription.unsubscribe();
    }

    private handleMidiMessage = (message: WebMidi.MIDIMessageEvent) => {
        if (message.data[0] === 144) {
            const note = message.data[1];
            this.playNote(note);
        }
    };

    private playNote(note: number) {
        const frequency = 440 * Math.pow(2, (note - 69) / 12); // note -> frequency

        this.osc.play(frequency);
    }

}

class MyOscillator {
    private readonly audioContext: AudioContext;
    private readonly osc: OscillatorNode;
    private readonly oscGain: GainNode;
    private gainAudioParam: AudioParam;

    constructor(private context: AudioContext) {
        this.audioContext = context;
        this.osc = this.createOscillator(this.audioContext);
        // create a gain node so that we can control volume
        this.oscGain = this.createGainNode(this.audioContext);
        this.gainAudioParam = this.oscGain.gain.setValueAtTime(0, this.audioContext.currentTime);

        // wire them up
        this.osc.connect(this.oscGain);
        this.oscGain.connect(this.audioContext.destination);
    }

    play(frequency: number) {
        this.gainAudioParam && this.gainAudioParam.cancelScheduledValues(this.audioContext.currentTime);
        this.oscGain.gain.value = 0.7;
        this.osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        // release
        this.gainAudioParam = this.oscGain.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + 2);
    }

    private createOscillator(audioContext: AudioContext): OscillatorNode {
        const osc = audioContext.createOscillator();
        osc.type = 'square';

        osc.start();

        return osc;
    }

    private createGainNode(audioContext: AudioContext) {
        return new GainNode(audioContext, {gain: 0});
    }
}

new Main();
