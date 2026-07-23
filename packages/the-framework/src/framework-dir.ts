/**
 * The directory, under a project root, that holds The Framework's own files.
 *
 * Its own module because it is the one piece of `logs.ts` the browser needs: the preset registry
 * builds `tf.presets.<name>.filePath` from it (#874), and the dashboard renders presets in the
 * browser (#520), where `logs.ts` cannot go — it imports `node:path`.
 */
export const THE_FRAMEWORK_DIR = '.the-framework'
