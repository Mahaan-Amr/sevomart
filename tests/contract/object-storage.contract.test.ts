import { FakeObjectStorage } from "../../apps/api/src/modules/media/testing/fake-object-storage";
import { runObjectStorageContract } from "./object-storage.contract";

runObjectStorageContract("FakeObjectStorage", () => new FakeObjectStorage());
