import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { RuntimeOptions, region, logger } from "firebase-functions/v1";
import { load } from "cheerio";
const app = initializeApp();
const db = getFirestore(app);
const config: RuntimeOptions = { memory: "128MB", timeoutSeconds: 24, failurePolicy: true };

// // Start writing functions
// // https://firebase.google.com/docs/functions/typescript
//

export const ZsemPlan = region("europe-central2")
    .runWith(config)
    .pubsub
    .schedule("0 23,7,16 * * *")
    .timeZone("Europe/Warsaw")
    .onRun(
        async (_ctx) => {
            const res = await fetch("https://zsem.edu.pl/plany/plany/o21.html")

            if (res.ok) {
                const text = await res.text();
                const $ = load(text);
                const table = $("table.tabela")
                const rows = table.find("tr")
                const columns: fullLesson[][][] = []
                const times: string[] = []
                rows.each((_i, row) => {
                    const cells = $(row).find("td")
                    times.push($(row).find("td.g").text())
                    cells.each((i, cell) => {
                        if (!columns[i]) {
                            columns[i] = []
                        }

                        const obj: fullLesson[] = []
                        const less = $(cell).find("span:has(a)")
                        if (less.length === 0) {
                            const lesson = $(cell).find("span.p").text()
                            const teacher = {
                                id: $(cell).find("a.n").attr("href") || "",
                                short: $(cell).find("a.n").text()
                            }
                            const room = {
                                id: $(cell).find("a.s").attr("href") || "",
                                short: $(cell).find("a.s").text()
                            }
                            obj[0] = {
                                lesson, teacher, room
                            }
                        }
                        less.each((i, el) => {
                            const lesson = $(el).find("span.p").text()
                            const teacher = {
                                id: $(el).find("a.n").attr("href") || "",
                                short: $(el).find("a.n").text()
                            }
                            const room = {
                                id: $(el).find("a.s").attr("href") || "",
                                short: $(el).find("a.s").text()
                            }
                            obj[i] = {
                                lesson, teacher, room
                            }
                        })
                        columns[i].push(obj)
                    })
                })
                times.shift()
                const timeTable = columns.map(e => e.map((e, i) => {
                    return { time: times[i], lessons: e }
                }))
                timeTable.splice(0, 2)
                db.collection("TimeTableData").add({ timeTable: JSON.stringify(timeTable), createdAt: new Date() })

            } else {
                logger.warn(res.status, res.statusText, await res.text())

            }

            return true
        },
    );

export const substitutionFetch = region("europe-central2")
    .runWith(config)
    .pubsub
    .schedule("0 23,7,16 * * *")
    .timeZone("Europe/Warsaw")
    .onRun(
        async (_ctx) => {
            const headers = new Headers()
            headers.append("Authorization", "Basic " + Buffer.from("zsem:123456").toString("base64"))
            const now = new Date()
            const addresses = []
            for (let i = 0; i < 7; i++) {
                const substitutionId = (now.getDate() + i).toString().padStart(2, "0") + (now.getMonth() + 1).toString().padStart(2, "0") + now.getFullYear();
                const address = `https://zsem.edu.pl/zastepstwa/${substitutionId}.html`
                addresses.push(address)

            }
            const result = (await Promise.all(addresses.map(e => fetchSubstitutions(e, headers)))).map(e => e || "err")
            const data = { result, createdAt: now }
            db.collection("substitutions").add(data);
            return true
        }
    )
export const idsFetch = region("europe-central2")
    .runWith(config)
    .pubsub
    .schedule("0 23 * * *")
    .timeZone("Europe/Warsaw")
    .onRun(
        async (_ctx) => {

            const urls = []
            for (let i = 1; i < 100; i++) {
                urls.push(`https://zsem.edu.pl/plany/plany/n${i}.html`)
            }
            const result: (teacher | undefined)[] = await Promise.all(urls.map(e => fetchTeachers(e)))
            db.collection("teachers").add({ result, createdAt: new Date() })
            return true
        }
    )

export const firestoreClear = region("europe-central2")
    .runWith(config)
    .pubsub
    .schedule("0 0 * * *")
    .timeZone("Europe/Warsaw")
    .onRun(
        (_ctx) => {
            Promise.all([
                cleanCollection("TimeTableData"),
                cleanCollection("subtitutions"),
                cleanCollection("teachers")
            ])
            return true
        }
    )

interface teacher {
    id: string;
    name: string;
    short: string;
}
interface fullLesson {
    lesson: string;
    teacher: {
        id: string;
        short: string;
    };
    room: {
        id: string;
        short: string;
    };
}
interface subtitution {
    nr: string;
    teacher: string;
    class: string;
    subject: string;
    room: string;
    subctitute: string;
    reason: string;
    notes: string;
}

async function fetchSubstitutions(address: string, headers: Headers) {
    const res = await fetch(address,
        { headers }).catch(e => {
            logger.warn(e);
            throw e;
        });
    if (res.ok && res.url == address) {
        const result: subtitution[] = [];
        const text = await res.text();
        const $ = load(text);
        const table = $("table");
        const rows = table.find("tr");
        rows.slice(0, 2).remove();
        rows.each((i, e) => {
            const cells = $(e).find("td");
            result.push({
                nr: cells.eq(0).text(),
                teacher: cells.eq(1).text(),
                class: cells.eq(2).text(),
                subject: cells.eq(3).text(),
                room: cells.eq(4).text(),
                subctitute: cells.eq(5).text(),
                reason: cells.eq(6).text(),
                notes: cells.eq(7).text()
            });

        });
        result.splice(0, 2);
        return { result, address };
    }
    else {
        logger.warn(res.status, res.statusText, await res.text());
        return
    }
}

async function fetchTeachers(url: string) {
    const res = await fetch(url);
    if (res.ok) {
        const $ = load(await res.text());
        const text = $(".tytulnapis").text().split(" ");
        return {
            id: url?.substring(32) || "",
            name: text[0] || "",
            short: text[1]?.substring(1, 3) || ""
        };
    }
    else {
        logger.warn(res.status, res.statusText)
        return;
    }
}

async function cleanCollection(collection: string) {
    const docRef = await db.collection(collection).orderBy("createdAt", "desc").limit(1).get();
    if (docRef.docs.length == 1) {
        let createdAt: Timestamp = docRef.docs[0].get("createdAt");
        const docsToDelete = await db.collection(collection).where("createdAt", "<", createdAt).get();
        docsToDelete.forEach(e => e.ref.delete());
        logger.info(docsToDelete);
    }
    else {
        logger.error("nothing to clear");
    }
}

