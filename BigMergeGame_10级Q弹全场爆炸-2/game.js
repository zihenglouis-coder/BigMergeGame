const {
    Engine,
    Runner,
    Bodies,
    Composite,
    Events,
    Body
} = Matter;


/* =========================================================
   BASIC SETTINGS
========================================================= */

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const scoreElement = document.getElementById("score");
const nextBallElement = document.getElementById("next-ball");

const gameOverElement = document.getElementById("game-over");
const finalScoreElement = document.getElementById("final-score");
const bestScoreElement = document.getElementById("best-score");
const restartButton = document.getElementById("restart-btn");
const blastButton = document.getElementById("blast-btn");
const blastCountElement = document.getElementById("blast-count");
const comboStatusElement = document.getElementById("combo-status");


/*
    游戏内部固定尺寸

    Canvas 在网页上可以缩放，
    但是 Matter.js 一直使用这一套坐标。
*/

const WIDTH = 540;
const HEIGHT = 720;


/* =========================================================
   BALL LEVELS
========================================================= */

/*
    比之前明显放大。

    之前：
    22 / 27 / 32 / 38 / 45 / 52 / 60 / 69

    现在：
    28 / 34 / 41 / 49 / 58 / 68 / 80 / 94

    所以一开始的球就会更大。
*/

const LEVELS = [
    {
        radius: 30,
        color: "#ff6b6b"
    },
    {
        radius: 45,
        color: "#ffa94d"
    },
    {
        radius: 60,
        color: "#ffd43b"
    },
    {
        radius: 80,
        color: "#69db7c"
    },
    {
        radius: 85,
        color: "#38d9a9"
    },
    {
        radius: 115,
        color: "#4dabf7"
    },
    {
        radius: 130,
        color: "#748ffc"
    },
    {
        radius: 150,
        color: "#da77f2"
    },
    {
        radius: 165,
        color: "#f06595"
    },
    {
        radius: 180,
        color: "#20c997"
    }
];

const MAX_LEVEL = LEVELS.length - 1;

/* =========================================================
   BALL STICKER IMAGES
========================================================= */

// 8 张贴纸图片，对应 Level 1 → Level 8。
// 图片放在 BigMergeGame/assets/ 文件夹里。
// Images and outlines are prepared together before physics starts.
Matter.Common.setDecomp(window.decomp);
let assetsReady = false;
let debugColliders = false;
let mergeQueue = [];
let blastCharges = 0;
let blastStartedAt = 0;
let blastUntil = 0;
let blastProtectUntil = 0;
let lastMergeAt = -Infinity;
let mergeComboCount = 0;
let mergeComboUntil = 0;

const BASE_RESTITUTION = 0.30;
const MAX_RESTITUTION = 0.82;
const COMBO_WINDOW = 1500;
const BLAST_DURATION = 1850;
let pointerIsDown = false;
let activePointerId = null;
let pointerMoved = false;
let pointerStartX = 0;
let pointerStartY = 0;

/* =========================================================
   GAME VARIABLES
========================================================= */

let engine;
let runner;

let balls = new Set();

let currentLevel = 0;
let nextLevel = 0;

let score = 0;

let previewX = WIDTH / 2;

let canDrop = true;

let gameOver = false;


/*
    防止疯狂点击导致两个球同时出生
*/

let dropCooldown = 300;
let lastDropTime = 0;


/* =========================================================
   GAME OVER SETTINGS
========================================================= */

/*
    顶部危险区域。

    球如果长期停留在这里，
    才会真正 Game Over。

    不会因为球刚生成在顶部就立即 Game Over。
*/

const DANGER_LINE = 115;


/*
    球进入危险区以后，
    必须持续保持危险状态这么久。

    1.2 秒比较合理。
*/

const DANGER_TIME = 1200;

let dangerStartTime = null;


/*
    新生成的球在这段时间内
    不参与 Game Over 判断。

    这样球从顶部掉下去的时候
    不会被误判。
*/

const SPAWN_PROTECTION = 1000;


/* =========================================================
   CANVAS
========================================================= */

function resizeCanvas() {

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;

    ctx.setTransform(
        dpr,
        0,
        0,
        dpr,
        0,
        0
    );
}

resizeCanvas();

window.addEventListener("resize", resizeCanvas);


/* =========================================================
   RANDOM LEVEL
========================================================= */

function randomLevel() {

    /*
        大多数时候生成小球。

        越大的球出现概率越低。
    */

    const r = Math.random();

    if (r < 0.55) return 0;
    if (r < 0.82) return 1;
    if (r < 0.94) return 2;
    if (r < 0.985) return 3;

    return 4; // level 5 starts occasionally; levels 6–10 come from merges.
}


/* =========================================================
   GET BALL DATA
========================================================= */

function getRadius(level) {
    return LEVELS[level].radius;
}

function getColor(level) {
    return LEVELS[level].color;
}


/* =========================================================
   CREATE BALL
========================================================= */

function createBall(x, y, level) {

    const radius = getRadius(level);

    const sprite = SPRITES[level];
    const scale = radius * 2 / Math.max(sprite.width, sprite.height);
    const width = sprite.width * scale, height = sprite.height * scale;
    const options = {label: "ball", restitution: getComboRestitution(), friction: 0.35,
        frictionStatic: 0.5, frictionAir: 0.015, density: 0.0015};
    // Decompose each concave outline into convex parts without filling its
    // concave silhouette with a circle or a convex hull.
    const parts = [];
    for (const outline of COLLISION_DATA[level].polygons) {
        const points = outline.map(([px, py]) => [px * width, py * height]);
        window.decomp.makeCCW(points);
        window.decomp.removeDuplicatePoints(points, 0.0001);
        window.decomp.removeCollinearPoints(points, 0.0001);
        for (const polygon of window.decomp.quickDecomp(points)) {
            const vertices = polygon.map(([px, py]) => ({x: px, y: py}));
            const centre = Matter.Vertices.centre(vertices);
            parts.push(Body.create({...options, position: centre, vertices}));
        }
    }
    if (!parts.length) throw new Error("人物轮廓为空");
    // Suppress duplicate internal edges where two convex pieces meet.
    for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
            const a = parts[i].vertices, b = parts[j].vertices;
            for (let k = 0; k < a.length; k++) {
                for (let m = 0; m < b.length; m++) {
                    const a0 = a[k], a1 = a[(k + 1) % a.length];
                    const b0 = b[m], b1 = b[(m + 1) % b.length];
                    if (Math.hypot(a0.x - b1.x, a0.y - b1.y) < 0.01 &&
                        Math.hypot(a1.x - b0.x, a1.y - b0.y) < 0.01) {
                        a0.isInternal = b0.isInternal = true;
                    }
                }
            }
        }
    }
    const ball = Body.create({...options, parts});
    // Matter uses centre of mass, which differs from an image's box centre.
    // Preserve this offset so rotating graphics stay on their physics parts.
    ball.spriteOffset = {x: -ball.position.x, y: -ball.position.y};
    ball.spriteSize = {width, height};
    Body.setPosition(ball, {x, y});

    /*
        给每个球保存自己的游戏信息
    */

    ball.gameData = {

        level: level,

        radius: radius,

        spawnTime: performance.now(),

        merging: false

    };


    balls.add(ball);

    Composite.add(engine.world, ball);

    return ball;
}


/* =========================================================
   CREATE WALLS
========================================================= */

function createWalls() {

    const wallThickness = 40;

    const floor = Bodies.rectangle(
        WIDTH / 2,
        HEIGHT + wallThickness / 2,
        WIDTH,
        wallThickness,
        {
            isStatic: true,

            label: "wall",

            friction: 0.8,

            restitution: 0.12
        }
    );


    const leftWall = Bodies.rectangle(
        -wallThickness / 2,
        HEIGHT / 2,
        wallThickness,
        HEIGHT,
        {
            isStatic: true,

            label: "wall",

            friction: 0.8,

            restitution: 0.12
        }
    );


    const rightWall = Bodies.rectangle(
        WIDTH + wallThickness / 2,
        HEIGHT / 2,
        wallThickness,
        HEIGHT,
        {
            isStatic: true,

            label: "wall",

            friction: 0.8,

            restitution: 0.12
        }
    );


    Composite.add(
        engine.world,
        [
            floor,
            leftWall,
            rightWall
        ]
    );
}


/* =========================================================
   INITIALIZE GAME
========================================================= */

function initGame() {

    engine = Engine.create();

    engine.gravity.y = 1.10;


    /*
        Matter.js 本身负责物理。

        不自己写碰撞计算。
    */

    balls = new Set();
    mergeQueue = [];
    blastCharges = 0;
    blastStartedAt = 0;
    blastUntil = 0;
    blastProtectUntil = 0;
    lastMergeAt = -Infinity;
    mergeComboCount = 0;
    mergeComboUntil = 0;
    updateBlastButton();
    updateComboStatus();


    currentLevel = randomLevel();

    nextLevel = randomLevel();

    score = 0;

    gameOver = false;
    updateBlastButton();

    canDrop = true;

    lastDropTime = 0;
    dangerStartTime = null;


    scoreElement.textContent = score;


    gameOverElement.classList.add("hidden");


    createWalls();

    updateNextDisplay();


    /*
        碰撞事件
    */

    Events.on(
        engine,
        "collisionStart",
        handleCollision
    );
    Events.on(engine, "afterUpdate", () => {
        const queued = mergeQueue;
        mergeQueue = [];
        if (!gameOver) for (const [a, b] of queued) mergeBalls(a, b);
    });


    runner = Runner.create();

    Runner.run(
        runner,
        engine
    );
}


/* =========================================================
   NEXT DISPLAY
========================================================= */

function updateNextDisplay() {
    nextBallElement.style.backgroundColor = "transparent";
    nextBallElement.style.backgroundImage = `url("${SPRITES[nextLevel].toDataURL()}")`;
    nextBallElement.style.backgroundSize = "contain";
    nextBallElement.style.backgroundRepeat = "no-repeat";
    nextBallElement.style.backgroundPosition = "center";
    nextBallElement.textContent = "";
}

function getSpriteSize(level) {
    const sprite = SPRITES[level];
    const scale = getRadius(level) * 2 / Math.max(sprite.width, sprite.height);
    return {width: sprite.width * scale, height: sprite.height * scale};
}

function getDropPose(level) {
    const {width, height} = getSpriteSize(level);
    return {x: Math.max(width / 2 + 2, Math.min(WIDTH - width / 2 - 2, previewX)),
        y: Math.max(65, height / 2 + 2)};
}

/* =========================================================
   DROP BALL
========================================================= */

function dropBall() {

    if (!assetsReady || !engine) return;

    if (gameOver) {
        return;
    }


    const now = performance.now();


    /*
        防止点击过快
    */

    if (
        now - lastDropTime <
        dropCooldown
    ) {
        return;
    }


    lastDropTime = now;


    const {x, y} = getDropPose(currentLevel);
    const ball = createBall(x, y, currentLevel);
    // Put the image's box centre at the preview position, not its centre of mass.
    Body.translate(ball, {x: -ball.spriteOffset.x, y: -ball.spriteOffset.y});

    /*
        NEXT → CURRENT
    */

    currentLevel = nextLevel;

    nextLevel = randomLevel();


    updateNextDisplay();
}


/* =========================================================
   COLLISION
========================================================= */

function handleCollision(event) {

    if (gameOver) {
        return;
    }


    for (const pair of event.pairs) {

        const a = pair.bodyA.parent || pair.bodyA;
        const b = pair.bodyB.parent || pair.bodyB;


        if (
            a.label !== "ball" ||
            b.label !== "ball"
        ) {
            continue;
        }


        const dataA = a.gameData;
        const dataB = b.gameData;


        if (!dataA || !dataB) {
            continue;
        }


        /*
            只有相同等级才合成
        */

        if (
            dataA.level !== dataB.level
        ) {
            continue;
        }


        /*
            最大等级暂时不能继续合成
        */

        if (
            dataA.level >= MAX_LEVEL
        ) {
            continue;
        }


        /*
            防止同一帧重复合成
        */

        if (
            dataA.merging ||
            dataB.merging
        ) {
            continue;
        }


        dataA.merging = true;
        dataB.merging = true;


        mergeQueue.push([a, b]);
    }
}


/* =========================================================
   MERGE
========================================================= */

function mergeBalls(a, b) {

    if (
        !balls.has(a) ||
        !balls.has(b)
    ) {
        return;
    }


    const level =
        a.gameData.level;


    const newLevel =
        Math.min(
            level + 1,
            MAX_LEVEL
        );


    /*
        新球生成在两个球中间
    */

    const x =
        (a.position.x + b.position.x) / 2;

    const y =
        (a.position.y + b.position.y) / 2;


    /*
        删除旧球
    */

    balls.delete(a);
    balls.delete(b);

    Composite.remove(
        engine.world,
        a
    );

    Composite.remove(
        engine.world,
        b
    );

    registerMergeCombo();


    /*
        创建新球
    */

    const newBall =
        createBall(
            x,
            y,
            newLevel
        );


    /*
        稍微向上弹一下，

        让合成感觉更自然。
    */

    Body.setVelocity(
        newBall,
        {
            x:
                (
                    a.velocity.x +
                    b.velocity.x
                ) / 2,

            y:
                Math.min(
                    (
                        a.velocity.y +
                        b.velocity.y
                    ) / 2 - 2,

                    0
                )
        }
    );


    /*
        分数

        等级越高，合成获得的分数越高。
    */

    score +=
        (newLevel + 1) * 10;


    scoreElement.textContent =
        score;

    // Merging two level-6 balls creates ball7 and grants one blast charge.
    if (newLevel === 6) {
        blastCharges += 1;
        updateBlastButton();
        comboStatusElement.textContent = "获得全场爆炸！";
        comboStatusElement.classList.remove("hidden");
        comboStatusElement.classList.add("blast-earned");
        setTimeout(() => {
            comboStatusElement.classList.remove("blast-earned");
            updateComboStatus();
        }, 900);
    }
}


function getComboRestitution() {
    if (mergeComboUntil <= performance.now() || mergeComboCount <= 0) return BASE_RESTITUTION;
    const chainBoost = Math.min(5, Math.max(0, mergeComboCount - 1)) * 0.095;
    const timeLeft = Math.max(0, mergeComboUntil - performance.now()) / COMBO_WINDOW;
    return Math.min(MAX_RESTITUTION, BASE_RESTITUTION + chainBoost + 0.08 * timeLeft);
}

function setBallRestitution(ball, value) {
    ball.restitution = value;
    for (const part of ball.parts) part.restitution = value;
}

function applyComboRestitution() {
    const value = getComboRestitution();
    for (const ball of balls) setBallRestitution(ball, value);
}

function updateComboStatus() {
    if (!comboStatusElement) return;
    if (mergeComboCount > 1 && mergeComboUntil > performance.now()) {
        comboStatusElement.textContent = "Combo ×" + mergeComboCount;
        comboStatusElement.classList.remove("hidden");
    } else if (!comboStatusElement.classList.contains("blast-earned")) {
        comboStatusElement.textContent = "";
        comboStatusElement.classList.add("hidden");
    }
}

function registerMergeCombo() {
    const now = performance.now();
    mergeComboCount = now - lastMergeAt <= COMBO_WINDOW ? mergeComboCount + 1 : 1;
    lastMergeAt = now;
    mergeComboUntil = now + COMBO_WINDOW;
    applyComboRestitution();
    updateComboStatus();
}

function updateComboExpiry() {
    if (mergeComboUntil && performance.now() >= mergeComboUntil) {
        mergeComboUntil = 0;
        mergeComboCount = 0;
        lastMergeAt = -Infinity;
        applyComboRestitution();
        updateComboStatus();
    }
}

function updateBlastButton() {
    if (!blastButton) return;
    blastCountElement.textContent = String(blastCharges);
    blastButton.disabled = blastCharges <= 0 || gameOver;
    blastButton.setAttribute("aria-label", "全场爆炸，剩余 " + blastCharges + " 次");
}

function triggerFullBlast() {
    if (gameOver || blastCharges <= 0 || !engine) return;
    blastCharges -= 1;
    updateBlastButton();

    const now = performance.now();
    blastStartedAt = now;
    blastUntil = now + BLAST_DURATION;
    blastProtectUntil = now + BLAST_DURATION;
    dangerStartTime = null;

    for (const ball of balls) {
        const dx = ball.position.x - WIDTH / 2;
        const dy = ball.position.y - HEIGHT * 0.58;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const sideways = 3.2 + Math.random() * 3.3;
        const lift = 12 + Math.random() * 6;
        Body.setVelocity(ball, {
            x: ball.velocity.x * 0.45 + dx / distance * sideways + (Math.random() - 0.5) * 2,
            y: Math.min(0, ball.velocity.y * 0.3) - lift + dy / distance * 2.6
        });
        Body.setAngularVelocity(ball, ball.angularVelocity + (Math.random() - 0.5) * 0.16);
    }
}

if (blastButton) blastButton.addEventListener("click", triggerFullBlast);

function drawBlastEffect() {
    const now = performance.now();
    if (now >= blastUntil || !blastStartedAt) return;

    const progress = Math.max(0, Math.min(1, (now - blastStartedAt) / BLAST_DURATION));
    const envelope = Math.sin(Math.PI * progress);
    const pulse = 0.5 + 0.5 * Math.sin(progress * Math.PI * 12);
    const sticker = SPRITES[6];

    ctx.save();
    ctx.fillStyle = "rgba(255,248,255," + (envelope * (0.025 + pulse * 0.10)) + ")";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const scale = Math.max(WIDTH / sticker.width, HEIGHT / sticker.height) * (1.02 + 0.045 * pulse);
    for (let i = 0; i < 3; i++) {
        const phase = progress * Math.PI * (8 + i) + i * 2.2;
        const x = WIDTH / 2 + Math.sin(phase) * (22 + i * 10);
        const y = HEIGHT / 2 + Math.cos(phase * 1.17) * (25 + i * 13);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(phase * 0.8) * (0.035 + i * 0.018));
        ctx.scale(i === 1 ? -1 : 1, 1);
        ctx.globalAlpha = envelope * (0.045 + pulse * 0.105);
        ctx.drawImage(sticker, -sticker.width * scale / 2, -sticker.height * scale / 2,
            sticker.width * scale, sticker.height * scale);
        ctx.restore();
    }

    ctx.restore();
}

/* =========================================================
   GAME OVER CHECK
========================================================= */

function checkGameOver() {

    if (gameOver) {
        return;
    }


    const now =
        performance.now();

    if (now < blastProtectUntil) {
        dangerStartTime = null;
        return;
    }

    let dangerous = false;


    for (const ball of balls) {

        const data =
            ball.gameData;


        /*
            新生成的球暂时不检查
        */

        if (
            now - data.spawnTime <
            SPAWN_PROTECTION
        ) {
            continue;
        }


        const top =
            ball.bounds.min.y;


        /*
            球顶部进入危险线
        */

        if (
            top <= DANGER_LINE
        ) {


            /*
                Matter.js 判断球是否已经比较稳定。

                不要求完全静止，
                只要运动已经很慢即可。
            */

            const speed =
                Math.sqrt(
                    ball.velocity.x *
                    ball.velocity.x +

                    ball.velocity.y *
                    ball.velocity.y
                );


            if (speed < 0.8) {

                dangerous = true;

                break;
            }
        }
    }


    if (dangerous) {

        if (
            dangerStartTime === null
        ) {

            dangerStartTime = now;

        } else if (
            now - dangerStartTime >=
            DANGER_TIME
        ) {

            endGame();
        }

    } else {

        /*
            只要球离开危险区，
            计时立即重新开始。
        */

        dangerStartTime = null;
    }
}


/* =========================================================
   END GAME
========================================================= */

function endGame() {

    if (gameOver) {
        return;
    }


    gameOver = true;
    updateBlastButton();


    /*
        停止 Matter.js 物理
    */

    Runner.stop(runner);


    /*
        显示最终分数
    */

    finalScoreElement.textContent = score;
    if (typeof window.saveGameScore === "function") window.saveGameScore(score);

    gameOverElement.classList.remove(
        "hidden"
    );
}


/* =========================================================
   DRAW BACKGROUND
========================================================= */

function drawBackground() {

    ctx.fillStyle = "#fafafa";

    ctx.fillRect(
        0,
        0,
        WIDTH,
        HEIGHT
    );


    /*
        顶部危险区域
    */

    ctx.fillStyle =
        "rgba(255, 80, 80, 0.055)";

    ctx.fillRect(
        0,
        0,
        WIDTH,
        DANGER_LINE
    );


    /*
        Danger line
    */

    ctx.save();

    ctx.setLineDash([
        8,
        8
    ]);

    ctx.strokeStyle =
        "rgba(255, 80, 80, 0.45)";

    ctx.lineWidth = 2;

    ctx.beginPath();

    ctx.moveTo(
        0,
        DANGER_LINE
    );

    ctx.lineTo(
        WIDTH,
        DANGER_LINE
    );

    ctx.stroke();

    ctx.restore();


    ctx.fillStyle =
        "rgba(255, 80, 80, 0.65)";

    ctx.font =
        "bold 11px Arial";

    ctx.fillText(
        "DANGER",
        12,
        DANGER_LINE - 8
    );
}


/* =========================================================
   DRAW BALL
========================================================= */

function drawBall(ball) {
    const {width, height} = ball.spriteSize;
    ctx.save();
    ctx.translate(ball.position.x, ball.position.y);
    ctx.rotate(ball.angle);
    ctx.drawImage(SPRITES[ball.gameData.level], ball.spriteOffset.x - width / 2,
        ball.spriteOffset.y - height / 2, width, height);
    ctx.restore();
    if (debugColliders) {
        ctx.save(); ctx.strokeStyle = "#00b5ff"; ctx.lineWidth = 1;
        const parts = ball.parts.length > 1 ? ball.parts.slice(1) : ball.parts;
        for (const part of parts) {
            ctx.beginPath();
            part.vertices.forEach((v, i) => i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y));
            ctx.closePath(); ctx.stroke();
        }
        ctx.restore();
    }
}

function drawPreview() {
    if (gameOver || !assetsReady) return;
    const {x, y} = getDropPose(currentLevel);
    const {width, height} = getSpriteSize(currentLevel);
    ctx.save();
    ctx.setLineDash([5, 7]); ctx.strokeStyle = "rgba(0,0,0,0.13)";
    ctx.beginPath(); ctx.moveTo(x, y + height / 2); ctx.lineTo(x, HEIGHT); ctx.stroke();
    ctx.globalAlpha = 0.82;
    ctx.drawImage(SPRITES[currentLevel], x - width / 2, y - height / 2, width, height);
    ctx.restore();
}

window.addEventListener("keydown", event => {
    if (event.key.toLowerCase() === "c") debugColliders = !debugColliders;
    if (event.key.toLowerCase() === "b") triggerFullBlast();
});

/* =========================================================
   RENDER
========================================================= */

function render() {

    drawBackground();


    /*
        先画真实球
    */

    for (const ball of balls) {

        drawBall(ball);
    }

    drawBlastEffect();
    updateComboExpiry();

    /*
        再画顶部预览球
    */

    drawPreview();


    /*
        Game Over 判断
    */

    checkGameOver();


    requestAnimationFrame(render);
}


/* =========================================================
   MOUSE / TOUCH
========================================================= */

function getCanvasX(event) {

    const rect =
        canvas.getBoundingClientRect();


    const ratio =
        WIDTH / rect.width;


    return (
        event.clientX -
        rect.left
    ) * ratio;
}


/*
    鼠标移动
*/

canvas.addEventListener(
    "pointermove",
    function(event) {

        if (gameOver) {
            return;
        }


        previewX =
            getCanvasX(event);
    }
);


/* Press or touch to aim. The ball drops only after pointerup. */
canvas.addEventListener("pointerdown", event => {
    event.preventDefault();
    if (gameOver || !assetsReady || pointerIsDown) return;
    pointerIsDown = true;
    activePointerId = event.pointerId;
    pointerMoved = false;
    pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    previewX = getCanvasX(event);
    try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
});

canvas.addEventListener("pointermove", event => {
    if (event.pointerId === activePointerId && pointerIsDown) {
        previewX = getCanvasX(event);
        const dx = event.clientX - pointerStartX;
        const dy = event.clientY - pointerStartY;
        if (Math.hypot(dx, dy) >= 10) pointerMoved = true;
    }
});

canvas.addEventListener("pointerup", event => {
    if (!pointerIsDown || event.pointerId !== activePointerId) return;
    event.preventDefault();
    previewX = getCanvasX(event);
    const shouldDrop = event.pointerType !== "touch" || pointerMoved;
    pointerIsDown = false;
    activePointerId = null;
    if (shouldDrop) dropBall();
});

canvas.addEventListener("pointercancel", event => {
    if (event.pointerId === activePointerId) {
        pointerIsDown = false;
        activePointerId = null;
        pointerMoved = false;
    }
});

/* =========================================================
   RESTART
========================================================= */

restartButton.addEventListener(
    "click",
    function() {

        if (!assetsReady) return;

        /*
            停止旧 Runner
        */

        if (runner) {
            Runner.stop(runner);
        }


        /*
            清空旧 Matter 世界
        */

        if (engine) {
            Composite.clear(
                engine.world,
                false
            );

            Engine.clear(engine);
        }


        initGame();
    }
);


/* =========================================================
   START
========================================================= */

document.querySelector(".hint").textContent = "正在准备人物贴纸…";
spritesReady.then(() => {
    assetsReady = true;
    document.querySelector(".hint").textContent = "拖动瞄准，松手投放 · 按 C 查看碰撞轮廓";
    initGame();
    render();
}).catch(error => {
    console.error(error);
    document.querySelector(".hint").textContent = "图片准备失败：" + error.message;
});
