import {combineLatest, fromEvent, interval, Observable, Subscription} from "rxjs";
import {filter, map, scan, share, shareReplay, startWith, switchMap, tap} from "rxjs/operators";

enum Subdivision {
    Quarter = 1,
    Eighth = 2,
    Sixteenth = 4
}

interface Period {
    absoluteSubdivisionIndex: number;
    subdivisionType: Subdivision;
    current: {
        duration: number; // in pulses
        currPeriodIndex: number;
    }
}

interface NoteEvent {
    curr?: number;
    previous?: number; // in case we need note off someday
}

interface Settings {
    bpm: number;
    subdivision: Subdivision;
    transpose: number;
    notes: number[];
}

const barLength = 4; // could make this user-configurable

function createPeriodStream(bpm: number, subdivision: Subdivision, maxDuration: number, minDuration: number): Observable<Period> {
    const pulseMilliseconds = 60 / bpm * 1000 / subdivision;

    return interval(pulseMilliseconds)
        .pipe(
            scan((note, i) => {
                const isComplete = note.current.currPeriodIndex + 1 >= note.current.duration;
                return {
                    absoluteSubdivisionIndex: i,
                    subdivisionType: subdivision,
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
                absoluteSubdivisionIndex: 0,
                subdivisionType: subdivision,
                current: {
                    duration: 0,
                    currPeriodIndex: 0
                }
            }),
            share()
        );

}

function createNoteEventStream(notes: number[], periodStream$: Observable<Period>, transpose: number) {
    return periodStream$.pipe(
        filter(pulse => { // silence every second phrase
            const phraseLength = pulse.subdivisionType * barLength;
            return Math.floor(pulse.absoluteSubdivisionIndex / phraseLength) % 2 === 0;
        }),
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
    private audio: Audio | undefined;
    private noteEventSubscription: Subscription | undefined;
    private noteEventStream$: Observable<NoteEvent>;
    private clickStream$: Observable<Period>;
    private settings: Settings;
    private clickSubscription: Subscription | undefined;

    constructor() {
        const playButton = document.getElementById('play-checkbox') as HTMLInputElement;
        const playButtonText = document.getElementById('play-button-text') as HTMLElement;
        if (playButton) {
            playButton.addEventListener('click', (event) => {
                const isPlaying = (event.target as HTMLInputElement).checked;
                if (isPlaying) {
                    playButtonText.innerHTML = '&#9724;';
                    this.start();
                } else {
                    playButtonText.innerHTML = '&#9654;';
                    this.stop();
                }
            })
        }

        this.settings = this.loadSettings();

        // get elements
        const notes = document.querySelectorAll('input[name="notes"]');
        const bpm = document.getElementById('bpm') as HTMLInputElement;
        const subdivision = document.querySelectorAll('input[name="subdivision"]');
        const transpose = document.getElementById('transpose') as HTMLInputElement;

        // set ui initial values
        Array.from(notes)
            .map(e => e as HTMLInputElement)
            .filter(checkbox => this.settings.notes.includes(+checkbox.value))
            .forEach(checkbox => checkbox.checked = true);
        bpm.valueAsNumber = this.settings.bpm;
        bpm.dispatchEvent(new Event('input'));
        Array.from(subdivision)
            .map(e => e as HTMLInputElement)
            .filter(radio => this.settings.subdivision === +radio.value)
            .forEach(radio => radio.checked = true);
        transpose.valueAsNumber = this.settings.transpose;
        transpose.dispatchEvent(new Event('input'));

        const notes$ = fromEvent<InputEvent>(notes, 'change')
            .pipe(
                map(() => {
                    const currentNotes = document.querySelectorAll('input[name="notes"]');
                    return Array.from(currentNotes)
                        .map(e => e as HTMLInputElement)
                        .filter(checkbox => checkbox.checked)
                        .map(checkbox => +checkbox.value);
                }),
                tap(notes => localStorage.setItem('notes', JSON.stringify(notes))),
                startWith(this.settings.notes)
            );

        const bpm$ = fromEvent<InputEvent>(bpm!, 'change')
            .pipe(
                map((event) => (event.target as HTMLInputElement).valueAsNumber),
                tap(bpm => localStorage.setItem('bpm', '' + bpm)),
                startWith(this.settings.bpm)
            );

        const subdivision$ = fromEvent<InputEvent>(subdivision, 'change')
            .pipe(
                map(() => {
                    const subdivisions = document.querySelectorAll('input[name="subdivision"]');
                    const selecteds = Array.from(subdivisions)
                        .map(e => e as HTMLInputElement)
                        .filter(radio => radio.checked)
                        .map(radio => radio.value);
                    return +selecteds[0]
                }),
                tap(subdivision => localStorage.setItem('subdivision', '' + subdivision)),
                startWith(this.settings.subdivision)
            );

        const transpose$ = fromEvent<InputEvent>(transpose!, 'change')
            .pipe(
                map((event) => (event.target as HTMLInputElement).valueAsNumber),
                tap(transpose => localStorage.setItem('transpose', '' + transpose)),
                startWith(this.settings.transpose)
            );

        // Emit new period stream whenever these change
        const periodStream$$ = combineLatest([bpm$, subdivision$])
            .pipe(
                map(([bpm, subdivision]) => {
                    const maxDuration = (subdivision * 2) - 1;
                    return createPeriodStream(bpm, subdivision, maxDuration, 1);
                }),
                shareReplay(1)
            );

        this.noteEventStream$ = combineLatest([notes$, periodStream$$, transpose$])
            .pipe(
                switchMap(([notes, periodStream$, transpose]) => createNoteEventStream(notes, periodStream$, transpose)),
            );

        this.noteEventStream$.subscribe(); // hack to enable setting changes before the first play

        this.clickStream$ = periodStream$$
            .pipe(
                switchMap(periodStream => periodStream),
                filter(period => period.absoluteSubdivisionIndex % period.subdivisionType === 0),
            );
    }

    private loadSettings() {
        return {
            bpm: +(localStorage.getItem('bpm') || 80),
            subdivision: +(localStorage.getItem('subdivision') || Subdivision.Eighth),
            maxDuration: +(localStorage.getItem('maxDuration') || 2),
            minDuration: +(localStorage.getItem('minDuration') || 1),
            transpose: +(localStorage.getItem('transpose') || 0),
            notes: JSON.parse(localStorage.getItem('notes') || '[60, 62, 63]')
        };
    }

    start() {
        if (!this.audio) {
            this.audio = new Audio();
        }

        this.clickSubscription = this.clickStream$
            .subscribe(() => this.audio?.click());

        this.noteEventSubscription = this.noteEventStream$
            .subscribe(noteEvent => this.playNote(noteEvent.curr!!));

    }

    stop() {
        this.noteEventSubscription && this.noteEventSubscription.unsubscribe();
        this.clickSubscription && this.clickSubscription.unsubscribe();
    }

    private playNote(note: number) {
        if (this.audio && note) {
            const frequency = 440 * Math.pow(2, (note - 69) / 12); // note -> frequency

            this.audio.play(frequency);
        }
    }

}

class Audio {
    private readonly audioContext: AudioContext = new AudioContext();
    private readonly osc: OscillatorNode;
    private readonly oscGain: GainNode;
    private gainAudioParam: AudioParam;
    private clickBuffer: AudioBuffer | undefined;

    constructor() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.osc = this.createOscillator(this.audioContext);
        // create a gain node so that we can control volume
        this.oscGain = new GainNode(this.audioContext, {gain: 0});
        this.gainAudioParam = this.oscGain.gain.setValueAtTime(0, this.audioContext.currentTime);

        // wire them up
        this.osc.connect(this.oscGain);
        this.oscGain.connect(this.audioContext.destination);

        this.createClickBuffer(this.audioContext)
            .then(buffer => this.clickBuffer = buffer);
    }

    play(frequency: number) {
        this.gainAudioParam && this.gainAudioParam.cancelScheduledValues(this.audioContext.currentTime);
        this.oscGain.gain.value = 0.8;
        this.osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
        // release
        this.gainAudioParam = this.oscGain.gain.exponentialRampToValueAtTime(0.0001, this.audioContext.currentTime + 2);
    }

    click() {
        if (this.clickBuffer) {
            const click = this.audioContext.createBufferSource();
            click.buffer = this.clickBuffer;
            click.connect(this.audioContext.destination);

            click.start();
        }
    }

    private async createClickBuffer(audioContext: AudioContext) {
        const response = await fetch('click.wav');
        const arrayBuffer: ArrayBuffer = await response.arrayBuffer();
        return await audioContext.decodeAudioData(arrayBuffer);
    }


    private createOscillator(audioContext: AudioContext): OscillatorNode {
        const osc = audioContext.createOscillator();
        osc.type = 'square';

        osc.start();

        return osc;
    }
}

new Main();
