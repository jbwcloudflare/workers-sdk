import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { endEventLoop } from "../helpers/end-event-loop";
import { mockConsoleMethods } from "../helpers/mock-console";
import { runInTempDir } from "../helpers/run-in-tmp";
import { runWrangler } from "../helpers/run-wrangler";
import { replaceRandomWithConstantData } from "../helpers/string-dynamic-values-matcher";

describe("functions build", () => {
	const std = mockConsoleMethods();

	runInTempDir();

	afterEach(async () => {
		// Force a tick to ensure that all promises resolve
		await endEventLoop();
	});

	it("should throw an error if no worker script and no Functions directory was found", async () => {
		await expect(runWrangler("pages functions build")).rejects.toThrowError();
		expect(std.err).toContain("Could not find anything to build.");
	});

	it("should build functions", async () => {
		/* ---------------------------- */
		/*       Set up Functions       */
		/* ---------------------------- */
		mkdirSync("functions");
		writeFileSync(
			"functions/hello.js",
			`
    export async function onRequest() {
      return new Response("Hello from Pages Functions");
    }
    `
		);

		/* --------------------------------- */
		/*     Run cmd & make assertions     */
		/* --------------------------------- */
		await runWrangler(`pages functions build`);

		expect(existsSync("_worker.js")).toBe(true);
		expect(std.out).toMatchInlineSnapshot(`
		"🚧 'wrangler pages <command>' is a beta command. Please report any issues to https://github.com/cloudflare/workers-sdk/issues/new/choose
		✨ Compiled Worker successfully"
	`);
		expect(std.err).toMatchInlineSnapshot(`""`);
	});

	it("should include any external modules imported by functions in the output bundle when the [--experimental-worker-bundle] flag is set", async () => {
		/* ---------------------------- */
		/*       Set up wasm files      */
		/* ---------------------------- */
		mkdirSync("wasm");
		writeFileSync("wasm/greeting.wasm", "Hello");
		writeFileSync("wasm/name.wasm", "wasm Functions");

		/* ---------------------------- */
		/*       Set up Functions       */
		/* ---------------------------- */
		mkdirSync("functions");
		writeFileSync(
			"functions/hello.js",
			`
    import hello from "./../wasm/greeting.wasm";
    import name from "./../wasm/name.wasm";

    export async function onRequest() {
      const greetingModule = await WebAssembly.instantiate(greeting);
			const nameModule = await WebAssembly.instantiate(name);
      return new Response(greetingModule.exports.hello + " " + nameModule.exports.name);
    }
    `
		);

		/* --------------------------------- */
		/*     Run cmd & make assertions     */
		/* --------------------------------- */
		await runWrangler(
			`pages functions build --outfile=_worker.bundle --experimental-worker-bundle=true`
		);

		expect(existsSync("_worker.bundle")).toBe(true);
		expect(std.out).toMatchInlineSnapshot(`
		"🚧 'wrangler pages <command>' is a beta command. Please report any issues to https://github.com/cloudflare/workers-sdk/issues/new/choose
		✨ Compiled Worker successfully"
	`);

		// some values in workerBundleContents, such as the undici form boundary
		// or the file hashes, are randomly generated. Let's replace them
		// with static values so we can test the file contents
		const workerBundleContents = readFileSync("_worker.bundle", "utf-8");
		const workerBundleWithConstantData = replaceRandomWithConstantData(
			workerBundleContents,
			[
				[/------formdata-undici-0.[0-9]*/g, "------formdata-undici-0.test"],
				[/functionsWorker-0.[0-9]*.js/g, "functionsWorker-0.test.js"],
				[/[0-9a-z]*-greeting.wasm/g, "test-greeting.wasm"],
				[/[0-9a-z]*-name.wasm/g, "test-name.wasm"],
			]
		);

		// check we appended the metadata
		expect(workerBundleWithConstantData).toContain(
			`Content-Disposition: form-data; name="metadata"`
		);
		expect(workerBundleWithConstantData).toContain(
			`{"main_module":"functionsWorker-0.test.js"}`
		);

		// check we appended the compiled Worker
		expect(workerBundleWithConstantData).toContain(
			`Content-Disposition: form-data; name="functionsWorker-0.test.js"; filename="functionsWorker-0.test.js"`
		);

		// check we appended the wasm modules
		expect(workerBundleWithConstantData).toContain(
			`Content-Disposition: form-data; name="./test-greeting.wasm"; filename="./test-greeting.wasm"`
		);
		expect(workerBundleWithConstantData).toContain(
			`Content-Disposition: form-data; name="./test-name.wasm"; filename="./test-name.wasm"`
		);
		expect(workerBundleWithConstantData).toContain(`Hello`);
		expect(workerBundleWithConstantData).toContain(`wasm Functions`);

		expect(std.err).toMatchInlineSnapshot(`""`);
	});

	it("should fail building if functions use external module imports, but the [--experimental-worker-bundle] flag is not set", async () => {
		/* ---------------------------- */
		/*       Set up wasm files      */
		/* ---------------------------- */
		mkdirSync("wasm");
		writeFileSync("wasm/greeting.wasm", "Hello wasm Functions!");

		/* ---------------------------- */
		/*       Set up Functions       */
		/* ---------------------------- */
		mkdirSync("functions");
		writeFileSync(
			"functions/hello.js",
			`
    import hello from "./../wasm/greeting.wasm";

    export async function onRequest() {
      const module = await WebAssembly.instantiate(greeting);
      return new Response(module.exports.hello);
    }
    `
		);

		/* --------------------------------- */
		/*     Run cmd & make assertions     */
		/* --------------------------------- */
		await expect(runWrangler(`pages functions build`)).rejects.toThrowError();
		expect(std.err).toContain(
			`ERROR: No loader is configured for ".wasm" files: ../wasm/greeting.wasm`
		);
	});

	it("should build _worker.js if the [--experimental-worker-bundle] flag is set", async () => {
		/* ---------------------------- */
		/*       Set up js files        */
		/* ---------------------------- */
		mkdirSync("utils");
		writeFileSync(
			"utils/meaning-of-life.js",
			`
export const MEANING_OF_LIFE = 21;
`
		);

		/* ---------------------------- */
		/*       Set up _worker.js      */
		/* ---------------------------- */
		mkdirSync("public");
		writeFileSync(
			"public/_worker.js",
			`
import { MEANING_OF_LIFE } from "./../utils/meaning-of-life.js";

export default {
  async fetch(request, env) {
    return new Response("Hello from _worker.js. The meaning of life is " + MEANING_OF_LIFE);
  },
};`
		);

		/* --------------------------------- */
		/*     Run cmd & make assertions     */
		/* --------------------------------- */
		await runWrangler(
			`pages functions build --build-output-directory=public --outfile=_worker.bundle --experimental-worker-bundle=true`
		);
		expect(existsSync("_worker.bundle")).toBe(true);
		expect(std.out).toMatchInlineSnapshot(`
		"🚧 'wrangler pages <command>' is a beta command. Please report any issues to https://github.com/cloudflare/workers-sdk/issues/new/choose
		✨ Compiled Worker successfully"
	`);

		// some values in workerBundleContents, such as the undici form boundary
		// or the file hashes, are randomly generated. Let's replace them
		// with static values so we can test the file contents
		const workerBundleContents = readFileSync("_worker.bundle", "utf-8");
		const workerBundleWithConstantData = replaceRandomWithConstantData(
			workerBundleContents,
			[
				[/------formdata-undici-0.[0-9]*/g, "------formdata-undici-0.test"],
				[/bundledWorker-0.[0-9]*.mjs/g, "bundledWorker-0.test.mjs"],
			]
		);

		expect(workerBundleWithConstantData).toMatchInlineSnapshot(`
		"------formdata-undici-0.test
		Content-Disposition: form-data; name=\\"metadata\\"

		{\\"main_module\\":\\"bundledWorker-0.test.mjs\\"}
		------formdata-undici-0.test
		Content-Disposition: form-data; name=\\"bundledWorker-0.test.mjs\\"; filename=\\"bundledWorker-0.test.mjs\\"
		Content-Type: application/javascript+module

		// ../utils/meaning-of-life.js
		var MEANING_OF_LIFE = 21;

		// _worker.js
		var worker_default = {
		  async fetch(request, env) {
		    return new Response(\\"Hello from _worker.js. The meaning of life is \\" + MEANING_OF_LIFE);
		  }
		};
		export {
		  worker_default as default
		};
		//# sourceMappingURL=bundledWorker-0.test.mjs.map

		------formdata-undici-0.test--"
	`);
		expect(std.err).toMatchInlineSnapshot(`""`);

		await expect(
			runWrangler(`pages functions build --build-output-directory=public`)
		).rejects.toThrowError();
		expect(std.err).toMatch(
			/ENOENT: no such file or directory, scandir '.*functions'/
		);
	});

	it("should include all external modules imported by _worker.js in the output bundle, when bundling _worker.js", async () => {
		/* ---------------------------- */
		/*       Set up wasm files      */
		/* ---------------------------- */
		mkdirSync("wasm");
		writeFileSync("wasm/greeting.wasm", "Hello");
		writeFileSync("wasm/name.wasm", "wasm _worker.js");

		/* ---------------------------- */
		/*       Set up _worker.js      */
		/* ---------------------------- */
		mkdirSync("public");
		writeFileSync(
			"public/_worker.js",
			`
import greeting from "./../wasm/greeting.wasm";
import name from "./../wasm/name.wasm";

export default {
  async fetch(request, env) {
    const greetingModule = await WebAssembly.instantiate(greeting);
    const nameModule = await WebAssembly.instantiate(name);
    return new Response(greetingModule.exports.hello + " " + nameModule.exports.name + "!");
  },
};`
		);

		/* --------------------------------- */
		/*     Run cmd & make assertions     */
		/* --------------------------------- */
		await runWrangler(
			`pages functions build --build-output-directory=public --experimental-worker-bundle=true`
		);

		// built to _worker.js by default
		expect(existsSync("_worker.js")).toBe(true);
		expect(std.out).toMatchInlineSnapshot(`
		"🚧 'wrangler pages <command>' is a beta command. Please report any issues to https://github.com/cloudflare/workers-sdk/issues/new/choose
		✨ Compiled Worker successfully"
	`);

		// some values in workerBundleContents, such as the undici form boundary
		// or the file hashes, are randomly generated. Let's replace them
		// with static values so we can test the file contents
		const workerBundleContents = readFileSync("_worker.js", "utf-8");
		const workerBundleWithConstantData = replaceRandomWithConstantData(
			workerBundleContents,
			[
				[/------formdata-undici-0.[0-9]*/g, "------formdata-undici-0.test"],
				[/bundledWorker-0.[0-9]*.mjs/g, "bundledWorker-0.test.mjs"],
				[/[0-9a-z]*-greeting.wasm/g, "test-greeting.wasm"],
				[/[0-9a-z]*-name.wasm/g, "test-name.wasm"],
			]
		);

		// check we appended the metadata
		expect(workerBundleWithConstantData).toContain(
			`Content-Disposition: form-data; name="metadata"`
		);
		expect(workerBundleWithConstantData).toContain(
			`{"main_module":"bundledWorker-0.test.mjs"}`
		);

		// check we appended the wasm modules
		expect(workerBundleWithConstantData).toContain(
			`Content-Disposition: form-data; name="./test-greeting.wasm"; filename="./test-greeting.wasm"`
		);
		expect(workerBundleWithConstantData).toContain(
			`Content-Disposition: form-data; name="./test-name.wasm"; filename="./test-name.wasm"`
		);
		expect(workerBundleWithConstantData).toContain(`Hello`);
		expect(workerBundleWithConstantData).toContain(`wasm _worker.js`);

		expect(std.err).toMatchInlineSnapshot(`""`);
	});

	it("should build _worker.js over /functions, if both are present and the [--experimental-worker-bundle] flag is set", async () => {
		/* ---------------------------- */
		/*       Set up _worker.js      */
		/* ---------------------------- */
		mkdirSync("public");
		writeFileSync(
			"public/_worker.js",
			`
export default {
  async fetch(request, env) {
    return new Response("Hello from _worker.js");
  },
};`
		);

		/* ---------------------------- */
		/*       Set up Functions       */
		/* ---------------------------- */
		mkdirSync("functions");
		writeFileSync(
			"functions/hello.js",
			`
    export async function onRequest() {
      return new Response("Hello from Pages Functions");
    }
    `
		);

		/* --------------------------------- */
		/*     Run cmd & make assertions     */
		/* --------------------------------- */
		await runWrangler(
			`pages functions build --outfile=public/_worker.bundle --experimental-worker-bundle=true`
		);

		expect(existsSync("public/_worker.bundle")).toBe(true);
		expect(std.out).toMatchInlineSnapshot(`
		"🚧 'wrangler pages <command>' is a beta command. Please report any issues to https://github.com/cloudflare/workers-sdk/issues/new/choose
		✨ Compiled Worker successfully"
	`);

		// some values in workerBundleContents, such as the undici form boundary
		// or the file hashes, are randomly generated. Let's replace them
		// with static values so we can test the file contents
		const workerBundleContents = readFileSync("public/_worker.bundle", "utf-8");
		const workerBundleWithConstantData = replaceRandomWithConstantData(
			workerBundleContents,
			[
				[/------formdata-undici-0.[0-9]*/g, "------formdata-undici-0.test"],
				[/bundledWorker-0.[0-9]*.mjs/g, "bundledWorker-0.test.mjs"],
			]
		);

		expect(workerBundleWithConstantData).toMatchInlineSnapshot(`
		"------formdata-undici-0.test
		Content-Disposition: form-data; name=\\"metadata\\"

		{\\"main_module\\":\\"bundledWorker-0.test.mjs\\"}
		------formdata-undici-0.test
		Content-Disposition: form-data; name=\\"bundledWorker-0.test.mjs\\"; filename=\\"bundledWorker-0.test.mjs\\"
		Content-Type: application/javascript+module

		// _worker.js
		var worker_default = {
		  async fetch(request, env) {
		    return new Response(\\"Hello from _worker.js\\");
		  }
		};
		export {
		  worker_default as default
		};
		//# sourceMappingURL=bundledWorker-0.test.mjs.map

		------formdata-undici-0.test--"
	`);

		expect(std.err).toMatchInlineSnapshot(`""`);
	});

	it("should leave Node.js imports when the `nodejs_compat` compatibility flag is set", async () => {
		mkdirSync("functions");
		writeFileSync(
			"functions/hello.js",
			`
		import { AsyncLocalStorage } from 'node:async_hooks';

    export async function onRequest() {
			console.log(AsyncLocalStorage);
      return new Response("Hello from Pages Functions");
    }
    `
		);

		await runWrangler(
			`pages functions build --outfile=public/_worker.js --compatibility-flag=nodejs_compat`
		);

		expect(existsSync("public/_worker.js")).toBe(true);
		expect(std.out).toMatchInlineSnapshot(`
		"🚧 'wrangler pages <command>' is a beta command. Please report any issues to https://github.com/cloudflare/workers-sdk/issues/new/choose
		✨ Compiled Worker successfully"
	`);

		expect(readFileSync("public/_worker.js", "utf-8")).toContain(
			`import { AsyncLocalStorage } from "node:async_hooks";`
		);
	});

	it("should error at Node.js imports when the `nodejs_compat` compatibility flag is not set", async () => {
		mkdirSync("functions");
		writeFileSync(
			"functions/hello.js",
			`
		import { AsyncLocalStorage } from 'node:async_hooks';

    export async function onRequest() {
			console.log(AsyncLocalStorage);
      return new Response("Hello from Pages Functions");
    }
    `
		);

		await expect(
			runWrangler(`pages functions build --outfile=public/_worker.js`)
		).rejects.toThrowErrorMatchingInlineSnapshot(`
		"Build failed with 1 error:
		hello.js:2:36: ERROR: Could not resolve \\"node:async_hooks\\""
	`);
	});
});
