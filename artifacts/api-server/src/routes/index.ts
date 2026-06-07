import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import roomsRouter from "./rooms";
import channelsRouter from "./channels";
import storageRouter from "./storage";
import giphyRouter from "./giphy";
import linkPreviewRouter from "./linkPreview";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(roomsRouter);
router.use(channelsRouter);
router.use(storageRouter);
router.use(giphyRouter);
router.use(linkPreviewRouter);

export default router;
