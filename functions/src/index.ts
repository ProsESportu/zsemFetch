import * as admin from "firebase-admin";

import * as functions from "firebase-functions";
import * as cheerio from "cheerio";

admin.initializeApp();
const db = admin.firestore();

// // Start writing functions
// // https://firebase.google.com/docs/functions/typescript
//

export const ZsemPlan = functions
    .region("europe-central2")
    .runWith({memory:"128MB",timeoutSeconds:24,failurePolicy:true})
    .pubsub
    .schedule("0 23,7,16 * * 1-5")
    .timeZone("Europe/Warsaw")
    .onRun(
        (ctx) => {
            fetch("https://zsem.edu.pl/plany/plany/o21.html")
                .then(async (res) => {
                    if (res.ok) {
                        const text = await res.text();
                        const $ = cheerio.load(text);
                        const table = $("table.tabela")
                        const rows = table.find("tr")
                        const columns: fullLesson[][][] = []
                        const times: string[] = []
                        rows.each((i, row) => {
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
                        functions.logger.warn(res.status, res.statusText)
                    }
                })
                .catch(
                    (e) => functions.logger.error(e),
                );
        },
    );

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