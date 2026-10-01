declare module "utif" {
  interface IFD {
    width: number;
    height: number;
    [k: string]: unknown;
  }
  const UTIF: {
    decode(buf: ArrayBuffer): IFD[];
    decodeImage(buf: ArrayBuffer, img: IFD, ifds?: IFD[]): void;
    toRGBA8(img: IFD): Uint8Array;
  };
  export default UTIF;
}
