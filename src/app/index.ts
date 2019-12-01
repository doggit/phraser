import {combineLatest, fromEvent, interval, Observable, Subscription} from "rxjs";
import {filter, map, scan, share, startWith, switchMap, tap} from "rxjs/operators";

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

function createNoteEventStream(notes: number[], bpm: number, pulseType: PulseType, maxDuration: number, minDuration: number, transpose: number) {
    const phraseLength = pulseType * 4;

    const period$ = createPeriodStream(bpm, pulseType, maxDuration, minDuration);

    return period$.pipe(
        filter(pulse => Math.floor(pulse.pulseIndex / phraseLength) % 2 === 0), // silence every second phrase
        filter(pulse => { // filter to only start of periods
            return pulse.current.currPeriodIndex + 1 === pulse.current.duration
        }),
        map(() => {
            const notesIndex = Math.floor(Math.random() * notes.length);
            return notes[notesIndex] + transpose;
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
    private osc: MyOscillator | undefined;
    private noteEventSubscription: Subscription | undefined;
    private noteEventStream: Observable<NoteEvent>;

    constructor() {
        const startButton = document.getElementById('start');
        if (startButton) {
            startButton.addEventListener('click', () => this.start())
        }

        const stopButton = document.getElementById('stop');
        if (stopButton) {
            stopButton.addEventListener('click', () => this.stop())
        }

        // get elements
        const subdivision = document.getElementById('subdivision') as HTMLSelectElement;
        const bpm = document.getElementById('bpm') as HTMLInputElement;
        const maxDuration = document.getElementById('max-duration') as HTMLInputElement;
        const minDuration = document.getElementById('min-duration') as HTMLInputElement;
        const transpose = document.getElementById('transpose') as HTMLInputElement;
        const notes = document.getElementById('notes') as HTMLSelectElement;

        // set ui initial values. // TODO: store in a cookie for revisits
        subdivision.selectedIndex = 1; // Eighth
        bpm.valueAsNumber = 80;
        maxDuration.valueAsNumber = 2;
        minDuration.valueAsNumber = 1;
        transpose.valueAsNumber = 0;
        // notes.selectedIndex = 4; // TODO?

        const bpm$ = fromEvent<InputEvent>(bpm!, 'change')
            .pipe(
                map((event) => (event.target as HTMLInputElement).valueAsNumber),
                startWith(80) // TODO: store in a cookie for revisits
            );

        const subdivision$ = fromEvent<InputEvent>(subdivision!, 'change')
            .pipe(
                map((event) => +(event.target as HTMLInputElement).value as PulseType),
                startWith(PulseType.Eighth)
            );

        const maxDuration$ = fromEvent<InputEvent>(maxDuration!, 'change')
            .pipe(
                map((event) => (event.target as HTMLInputElement).valueAsNumber),
                startWith(2)
            );

        const minDuration$ = fromEvent<InputEvent>(minDuration!, 'change')
            .pipe(
                map((event) => (event.target as HTMLInputElement).valueAsNumber),
                startWith(1)
            );

        const transpose$ = fromEvent<InputEvent>(transpose!, 'change')
            .pipe(
                map((event) => (event.target as HTMLInputElement).valueAsNumber),
                startWith(0)
            );

        const notes$ = fromEvent<InputEvent>(notes!, 'change')
            .pipe(
                map((event) => Array.from((event.target as HTMLSelectElement).selectedOptions).map(o => +o.value)),
                startWith([60, 62, 63])
            );

        this.noteEventStream = combineLatest([notes$, bpm$, subdivision$, maxDuration$, minDuration$, transpose$]).pipe(
            switchMap(([notes, bpm, subdivision, maxDuration, minDuration, transpose]) =>
                createNoteEventStream(notes, bpm, subdivision, maxDuration, minDuration, transpose)),
            share()
        );

        this.noteEventStream.subscribe(); // get the stream started
    }

    start() {
        if (!this.osc) {
            this.osc = new MyOscillator();
        }

        // TODO: create a transpose input
        console.log('start');
        this.noteEventSubscription = this.noteEventStream
            .subscribe(
                noteEvent => {
                    this.playNote(noteEvent.curr!!);
                }
            );
    }

    stop() {
        console.log('stop');
        this.noteEventSubscription && this.noteEventSubscription.unsubscribe();
    }

    private playNote(note: number) {
        if (this.osc) {
            const frequency = 440 * Math.pow(2, (note - 69) / 12); // note -> frequency

            console.log('note', note);

            this.osc.play(frequency);
        }
    }

}

class MyOscillator {
    private readonly audioContext: AudioContext = new AudioContext();
    private readonly osc: OscillatorNode;
    private readonly oscGain: GainNode;
    private gainAudioParam: AudioParam;

    constructor() {
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
        this.oscGain.gain.value = 0.8;
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
