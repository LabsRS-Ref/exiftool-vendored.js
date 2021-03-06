import * as _dt from "./datetime"
import * as _path from "path"

import { Tags } from "./tags"
import { Task } from "./task"

export class TagsTask extends Task<Tags> {
  private rawTags: any
  private readonly tags: Tags
  private tzoffset: number | undefined

  private constructor(readonly sourceFile: string, args: string[]) {
    super(args)
    const errors: string[] = []
    this.tags = { SourceFile: sourceFile, errors } as Tags
  }

  static for(filename: string, optionalArgs: string[] = []): TagsTask {
    const sourceFile = _path.resolve(filename)
    const args = [
      "-json",
      "-coordFormat", "%.8f", // Just a float, please, not the default of "22 deg 20' 7.58\" N"
      "-fast",
      ...optionalArgs,
      sourceFile
    ]
    return new TagsTask(sourceFile, args)
  }

  toString(): string {
    return "TagsTask(" + this.sourceFile + ")"
  }

  parse(data: string): Tags {
    this.rawTags = JSON.parse(data)[0]
    // ExifTool does humorous things to paths, like flip slashes. resolve() undoes that.
    const SourceFile = _path.resolve(this.rawTags.SourceFile)
    // Sanity check that the result is for the file we want:
    if (SourceFile !== this.sourceFile) {
      // Throw an error rather than add an errors string because this is *really* bad:
      throw new Error(
        `Internal error: unexpected SourceFile of ${this.rawTags.SourceFile} for file ${this.sourceFile}`
      )
    }
    return this.parseTags()
  }

  private addError(msg: string): void {
    this.tags.errors.push(msg)
  }

  private extractTzoffset(): void {
    // TimeZone wins if we've got it:
    const tze = new _dt.ExifTimeZoneOffset("TimeZone", this.rawTags.TimeZone)
    if (tze.tzOffsetMinutes !== undefined) {
      this.tzoffset = tze.tzOffsetMinutes
    } else if (this.rawTags.GPSDateTime != null && this.rawTags.DateTimeOriginal != null) {
      const gps = _dt.parse("GPSDateTime", this.rawTags.GPSDateTime, 0) as _dt.ExifDateTime
      const local = _dt.parse("DateTimeOriginal", this.rawTags.DateTimeOriginal, 0) as _dt.ExifDateTime
      if (gps && local && gps.toDate && local.toDate) {
        // timezone offsets are never less than 30 minutes.
        const gpsToHalfHour = gps.toDate().getTime() / (30 * 60 * 1000)
        const localToHalfHour = local.toDate().getTime() / (30 * 60 * 1000)
        this.tzoffset = 30 * Math.round(localToHalfHour - gpsToHalfHour)
      }
    }
  }

  private parseTags(): Tags {
    this.extractTzoffset()
    Object.keys(this.rawTags).forEach(key => {
      (this.tags as any)[key] = this.parseTag(key, this.rawTags[key])
    })
    return this.tags as Tags
  }

  private parseTag(tagName: string, value: any): any {
    try {
      if (tagName.endsWith("ExifToolVersion") ||
        tagName.endsWith("DateStampMode") || tagName.endsWith("Sharpness") ||
        tagName.endsWith("Firmware") || tagName.endsWith("DateDisplayFormat")) {
        return value.toString() // force to string
      } else if (tagName.endsWith("BitsPerSample")) {
        return value.toString().split(" ").map((i: string) => parseInt(i, 10))
      } else if (tagName.endsWith("FlashFired")) {
        const s = value.toString().toLowerCase()
        return (s === "yes" || s === "1" || s === "true")
      } else if (typeof value === "string" && tagName.includes("Date") || tagName.includes("Time")) {
        return _dt.parse(tagName, value, this.tzoffset)
      } else if (tagName.endsWith("GPSLatitude") || tagName.endsWith("GPSLongitude")) {
        const ref = (this.rawTags[tagName + "Ref"] || value.toString().split(" ")[1])
        if (ref === undefined) {
          return value // give up
        } else {
          const direction = ref.trim().toLowerCase()
          const sorw = direction.startsWith("w") || direction.startsWith("s")
          return parseFloat(value) * (sorw ? -1 : 1)
        }
      } else {
        return value
      }
    } catch (e) {
      this.addError(`Failed to parse ${tagName} with value ${JSON.stringify(value)}: ${e}`)
      return value
    }
  }
}
