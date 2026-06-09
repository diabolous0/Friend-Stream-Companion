import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import roomsRouter from "./rooms";
import channelsRouter from "./channels";
import storageRouter from "./storage";
import giphyRouter from "./giphy";
import linkPreviewRouter from "./linkPreview";
import friendsRouter from "./friends";
import blocksRouter from "./blocks";
import botsRouter from "./bots";
import serverInvitesRouter from "./serverInvites";
import serverInfoRouter from "./serverInfo";
import quickCallsRouter from "./quickCalls";

const router: IRouter = Router();

router.use(healthRouter);
router.use(serverInfoRouter);
router.use(quickCallsRouter);
router.use(authRouter);
router.use(serverInvitesRouter);
router.use(usersRouter);
router.use(roomsRouter);
router.use(channelsRouter);
router.use(storageRouter);
router.use(giphyRouter);
router.use(linkPreviewRouter);
router.use(friendsRouter);
router.use(blocksRouter);
router.use(botsRouter);

export default router;
