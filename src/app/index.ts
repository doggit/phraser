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

interface Settings {
    bpm: number;
    subdivision: PulseType;
    maxDuration: number;
    minDuration: number;
    transpose: number;
    notes: number[];
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
    private settings: Settings;

    constructor() {
        const startButton = document.getElementById('start');
        if (startButton) {
            startButton.addEventListener('click', () => this.start())
        }

        const stopButton = document.getElementById('stop');
        if (stopButton) {
            stopButton.addEventListener('click', () => this.stop())
        }

        this.settings = this.loadSettings();

        // get elements
        const bpm = document.getElementById('bpm') as HTMLInputElement;
        const subdivision = document.getElementById('subdivision') as HTMLSelectElement;
        const maxDuration = document.getElementById('max-duration') as HTMLInputElement;
        const minDuration = document.getElementById('min-duration') as HTMLInputElement;
        const transpose = document.getElementById('transpose') as HTMLInputElement;
        const notes = document.getElementById('notes') as HTMLSelectElement;

        // set ui initial values
        bpm.valueAsNumber = this.settings.bpm;
        bpm.dispatchEvent(new Event('input'));
        Array.from(subdivision.options).filter(o => +o.value === this.settings.subdivision).forEach(o => o.selected = true);
        subdivision.dispatchEvent(new Event('input'));
        maxDuration.valueAsNumber = this.settings.maxDuration;
        maxDuration.dispatchEvent(new Event('input'));
        minDuration.valueAsNumber = this.settings.minDuration;
        minDuration.dispatchEvent(new Event('input'));
        transpose.valueAsNumber = this.settings.transpose;
        transpose.dispatchEvent(new Event('input'));
        Array.from(notes.options).filter(o => this.settings.notes.includes(+o.value)).forEach(o => o.selected = true);

        const bpm$ = fromEvent<InputEvent>(bpm!, 'change')
            .pipe(
                map((event) => (event.target as HTMLInputElement).valueAsNumber),
                tap(bpm => localStorage.setItem('bpm', ''+bpm)),
                startWith(this.settings.bpm)
            );

        const subdivision$ = fromEvent<InputEvent>(subdivision!, 'change')
            .pipe(
                map((event) => +(event.target as HTMLInputElement).value as PulseType),
                tap(subdivision => localStorage.setItem('subdivision', ''+subdivision)),
                startWith(this.settings.subdivision)
            );

        const maxDuration$ = fromEvent<InputEvent>(maxDuration!, 'change')
            .pipe(
                map((event) => (event.target as HTMLInputElement).valueAsNumber),
                tap(maxDuration => localStorage.setItem('maxDuration', ''+maxDuration)),
                startWith(this.settings.maxDuration)
            );

        const minDuration$ = fromEvent<InputEvent>(minDuration!, 'change')
            .pipe(
                map((event) => (event.target as HTMLInputElement).valueAsNumber),
                tap(minDuration => localStorage.setItem('minDuration', ''+minDuration)),
                startWith(this.settings.minDuration)
            );

        const transpose$ = fromEvent<InputEvent>(transpose!, 'change')
            .pipe(
                map((event) => (event.target as HTMLInputElement).valueAsNumber),
                tap(transpose => localStorage.setItem('transpose', ''+transpose)),
                startWith(this.settings.transpose)
            );

        const notes$ = fromEvent<InputEvent>(notes!, 'change')
            .pipe(
                map((event) => Array.from((event.target as HTMLSelectElement).selectedOptions).map(o => +o.value)),
                tap(notes => localStorage.setItem('notes', JSON.stringify(notes))),
                startWith(this.settings.notes)
            );

        this.noteEventStream = combineLatest([notes$, bpm$, subdivision$, maxDuration$, minDuration$, transpose$]).pipe(
            switchMap(([notes, bpm, subdivision, maxDuration, minDuration, transpose]) =>
                createNoteEventStream(notes, bpm, subdivision, maxDuration, minDuration, transpose)),
            share()
        );

        this.noteEventStream.subscribe(); // get the stream started
    }

    private loadSettings() {
        return {
            bpm: +(localStorage.getItem('bpm') || 80),
            subdivision: +(localStorage.getItem('subdivision') || PulseType.Eighth),
            maxDuration: +(localStorage.getItem('maxDuration') || 2),
            minDuration: +(localStorage.getItem('minDuration') || 1),
            transpose: +(localStorage.getItem('transpose') || 0),
            notes: JSON.parse(localStorage.getItem('notes') || '[60, 62, 63]')
        };
    }
    start() {
        if (!this.osc) {
            this.osc = new MyOscillator();
        }

        this.noteEventSubscription = this.noteEventStream
            .subscribe(
                noteEvent => {
                    this.playNote(noteEvent.curr!!);
                }
            );
    }

    stop() {
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
